/**
 * Shared CRDT types.
 *
 * This file is intentionally duplicated (byte-for-byte) between server/src/crdt
 * and client/src/crdt rather than extracted into a shared npm workspace. For a
 * project this size that's a deliberate simplicity trade-off: a real production
 * codebase would hoist this into a shared package so server and client can
 * never drift apart. See README "Known trade-offs" for the reasoning.
 */

/** A globally unique identifier for one character, assigned at insert time. */
export interface CharId {
  /** The replica (browser tab / user session) that created this character. */
  site: string;
  /** A per-site monotonically increasing counter (Lamport-style logical clock). */
  clock: number;
}

/** One character in the replicated sequence, including tombstones. */
export interface RGAChar {
  id: CharId;
  value: string;
  /** Soft-deleted rather than removed, so concurrent ops can still resolve against it. */
  deleted: boolean;
  /** The id of the character this one was inserted immediately after, or null for "document start". */
  originId: CharId | null;
}

export type InsertOp = {
  type: 'insert';
  id: CharId;
  originId: CharId | null;
  value: string;
};

export type DeleteOp = {
  type: 'delete';
  id: CharId;
};

export type RGAOp = InsertOp | DeleteOp;

export function idsEqual(a: CharId | null, b: CharId | null): boolean {
  if (a === null || b === null) return a === b;
  return a.site === b.site && a.clock === b.clock;
}

/**
 * Total order over ids, used to deterministically resolve two concurrent
 * inserts at the same position. Every replica must use this exact comparator
 * or they will converge to different orderings.
 */
export function compareId(a: CharId, b: CharId): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  return a.site < b.site ? -1 : a.site > b.site ? 1 : 0;
}
