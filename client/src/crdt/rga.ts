import { CharId, RGAChar, RGAOp, InsertOp, DeleteOp, idsEqual, compareId } from './types';

/**
 * RGA (Replicated Growable Array) — a sequence CRDT for text.
 *
 * The core problem this solves: two people type at the same cursor position
 * at the same time, with no coordination between them (no lock, no central
 * "who goes first"). Both edits must be accepted, and every replica —
 * regardless of the order operations happen to arrive in over the network —
 * must end up with the exact same final document. That property is called
 * "strong eventual consistency", and it's the same class of problem Google
 * Docs, Figma, and Notion all solve under the hood.
 *
 * The trick: every character remembers the id of the character it was typed
 * immediately after ("originId"), not its numeric index. Indexes shift under
 * concurrent edits; a reference to a specific character does not. When two
 * inserts share the same origin (a genuine conflict — both typed at the same
 * spot), every replica breaks the tie the same way, using a total order over
 * character ids (see `compareId`). Deletes never remove a character outright;
 * they mark it a tombstone, so a delete arriving after a concurrent insert
 * next to it still has something to anchor to.
 *
 * Reference: Roh, Jeon, Kim & Lee, "Replicated abstract data types: Building
 * blocks for collaborative applications" (RGA), JPDC 2011.
 */
export class RGA {
  private chars: RGAChar[] = [];
  private clock = 0;
  readonly siteId: string;

  /**
   * Ops we can't integrate yet because they depend on a character (their
   * origin, or — for a delete — the character being deleted) we haven't
   * received. Keyed by that missing character's id. A WebSocket connection
   * delivers one sender's own messages in order, but this replica may also
   * be relayed messages from *several* senders whose relative arrival order
   * isn't guaranteed, or may reconnect mid-stream — so integration has to be
   * safe under arbitrary delivery order, not just assume it never happens.
   */
  private pending = new Map<string, RGAOp[]>();
  private static keyOf(id: CharId): string {
    return `${id.site}:${id.clock}`;
  }

  constructor(siteId: string) {
    this.siteId = siteId;
  }

  /** Rebuild a replica from a snapshot sent by the server on join. */
  static fromSnapshot(siteId: string, chars: RGAChar[]): RGA {
    const rga = new RGA(siteId);
    rga.chars = chars.map((c) => ({ ...c, id: { ...c.id }, originId: c.originId ? { ...c.originId } : null }));
    rga.clock = chars.reduce((max, c) => (c.id.site === siteId ? Math.max(max, c.id.clock) : max), 0);
    return rga;
  }

  toSnapshot(): RGAChar[] {
    return this.chars.map((c) => ({ ...c, id: { ...c.id }, originId: c.originId ? { ...c.originId } : null }));
  }

  /** The visible text, tombstones excluded. */
  toString(): string {
    let out = '';
    for (const c of this.chars) if (!c.deleted) out += c.value;
    return out;
  }

  get length(): number {
    let n = 0;
    for (const c of this.chars) if (!c.deleted) n++;
    return n;
  }

  /** Index into the full internal array (tombstones included) of the i-th visible character. */
  private visibleToInternalIndex(visibleIndex: number): number {
    let seen = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (!this.chars[i].deleted) {
        if (seen === visibleIndex) return i;
        seen++;
      }
    }
    return this.chars.length; // one past the end
  }

  /** The id of the visible character immediately before `visibleIndex`, or null at document start. */
  private originIdBefore(visibleIndex: number): CharId | null {
    if (visibleIndex <= 0) return null;
    const internal = this.visibleToInternalIndex(visibleIndex - 1);
    return this.chars[internal]?.id ?? null;
  }

  /**
   * The RGA "integrate" step: find where `newChar` belongs given its origin.
   * This is the one piece of logic every replica must run identically.
   *
   * After locating the origin, walk right past any character whose origin is
   * causally reachable from ours (same origin, or an origin that itself sits
   * after ours) AND which outranks us in the id total order — those are
   * concurrent siblings that already won the tie-break. Stop at the first one
   * that doesn't meet both conditions; that's where we insert.
   */
  private integrate(newChar: RGAChar): number {
    const originIndex = newChar.originId === null ? -1 : this.chars.findIndex((c) => idsEqual(c.id, newChar.originId));
    let i = originIndex + 1;

    while (i < this.chars.length) {
      const other = this.chars[i];
      const otherOriginIndex = other.originId === null ? -1 : this.chars.findIndex((c) => idsEqual(c.id, other.originId));

      if (otherOriginIndex < originIndex) break; // other descends from something before our origin — we've scanned past all siblings
      if (otherOriginIndex === originIndex) {
        if (compareId(other.id, newChar.id) > 0) { i++; continue; } // sibling outranks us, keep scanning
        break; // we outrank the sibling — insert here
      }
      i++; // other is a descendant of one of our siblings; keep scanning past it
    }
    return i;
  }

  /** Apply a local user edit: insert `value` (one or more characters) at visible position `index`. Returns the ops to broadcast. */
  localInsert(index: number, value: string): InsertOp[] {
    const ops: InsertOp[] = [];
    let originId = this.originIdBefore(index);
    for (const ch of value) {
      const id: CharId = { site: this.siteId, clock: ++this.clock };
      const newChar: RGAChar = { id, value: ch, deleted: false, originId };
      const pos = this.integrate(newChar);
      this.chars.splice(pos, 0, newChar);
      ops.push({ type: 'insert', id, originId, value: ch });
      originId = id; // subsequent characters in this batch chain off the one before
    }
    return ops;
  }

  /** Apply a local delete of the visible character at `index`. Returns the op to broadcast, or null if out of range. */
  localDelete(index: number): DeleteOp | null {
    if (index < 0 || index >= this.length) return null;
    const internal = this.visibleToInternalIndex(index);
    this.chars[internal].deleted = true;
    return { type: 'delete', id: this.chars[internal].id };
  }

  /**
   * Apply an op received from another replica (or echoed back from the
   * server). Idempotent for deletes, and safe to call in any order — an op
   * that arrives before its dependency is buffered and replayed automatically
   * once that dependency shows up.
   */
  applyRemote(op: RGAOp): void {
    if (op.type === 'insert') this.tryIntegrateInsert(op);
    else this.tryApplyDelete(op);
  }

  private tryIntegrateInsert(op: InsertOp): void {
    if (this.chars.some((c) => idsEqual(c.id, op.id))) return; // duplicate delivery
    if (op.originId !== null && !this.chars.some((c) => idsEqual(c.id, op.originId))) {
      this.defer(op.originId, op); // origin hasn't arrived yet
      return;
    }
    const newChar: RGAChar = { id: op.id, value: op.value, deleted: false, originId: op.originId };
    this.chars.splice(this.integrate(newChar), 0, newChar);
    this.releasePending(op.id);
  }

  private tryApplyDelete(op: DeleteOp): void {
    const c = this.chars.find((c) => idsEqual(c.id, op.id));
    if (c) { c.deleted = true; return; }
    this.defer(op.id, op); // the character to delete hasn't arrived yet
  }

  private defer(missingId: CharId, op: RGAOp): void {
    const key = RGA.keyOf(missingId);
    const list = this.pending.get(key) ?? [];
    list.push(op);
    this.pending.set(key, list);
  }

  /** Replay anything that was waiting on `id`, now that it exists. */
  private releasePending(id: CharId): void {
    const key = RGA.keyOf(id);
    const waiting = this.pending.get(key);
    if (!waiting) return;
    this.pending.delete(key);
    for (const op of waiting) this.applyRemote(op);
  }
}
