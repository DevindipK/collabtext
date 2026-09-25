import { RGA } from './rga';
import { RGAOp } from './types';

describe('RGA — sequential edits', () => {
  test('single replica insert and delete behaves like a normal string', () => {
    const a = new RGA('A');
    a.localInsert(0, 'hello');
    expect(a.toString()).toBe('hello');
    a.localInsert(5, ' world');
    expect(a.toString()).toBe('hello world');
    a.localDelete(0); // 'h'
    expect(a.toString()).toBe('ello world');
  });

  test('two replicas converge under sequential (non-concurrent) delivery', () => {
    const a = new RGA('A');
    const b = new RGA('B');

    const ops = a.localInsert(0, 'hi');
    for (const op of ops) b.applyRemote(op);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('hi');
  });
});

describe('RGA — concurrent edits converge (the actual point of a CRDT)', () => {
  test('two replicas typing at the same position at the same time converge, regardless of delivery order', () => {
    const a = new RGA('A');
    const b = new RGA('B');

    // Both start from the same base document.
    const base = a.localInsert(0, 'X');
    for (const op of base) b.applyRemote(op);
    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('X');

    // Now A and B *concurrently* insert at the same position (after 'X'),
    // with neither replica knowing about the other's edit yet.
    const opsA = a.localInsert(1, '1');
    const opsB = b.localInsert(1, '2');

    // Deliver in one order to A, the opposite order to B.
    for (const op of opsB) a.applyRemote(op);
    for (const op of opsA) b.applyRemote(op);

    expect(a.toString()).toBe(b.toString()); // <-- this is the property that matters
  });

  test('convergence holds across many replicas and randomized delivery order', () => {
    const sites = ['A', 'B', 'C', 'D'];
    const replicas = sites.map((s) => new RGA(s));
    const allOps: RGAOp[] = [];

    // Seed a common base.
    const base = replicas[0].localInsert(0, 'start');
    for (let i = 1; i < replicas.length; i++) for (const op of base) replicas[i].applyRemote(op);

    // Every replica makes a concurrent edit at an overlapping position,
    // *before* any of them have seen each other's edits.
    replicas.forEach((r, i) => {
      allOps.push(...r.localInsert(2, `[site${i}]`));
    });

    // Now deliver every op to every OTHER replica, in a different shuffled
    // order per replica, simulating an unordered network.
    function shuffled<T>(arr: T[]): T[] {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(((i + 7) * 2654435761) % (i + 1)); // deterministic pseudo-shuffle, no test flakiness
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }

    const opsPerReplica = allOps.length / replicas.length; // `[siteN]` is 7 chars, not a hardcoded guess
    replicas.forEach((r, i) => {
      const isMine = (idx: number) => Math.floor(idx / opsPerReplica) === i;
      const opsForMe = allOps.filter((_, idx) => !isMine(idx)); // skip my own ops (already applied locally)
      for (const op of shuffled(opsForMe)) r.applyRemote(op);
    });

    const finalStrings = replicas.map((r) => r.toString());
    expect(new Set(finalStrings).size).toBe(1); // every replica landed on the exact same string
  });

  test('concurrent insert next to a concurrently-deleted character does not crash or corrupt state', () => {
    const a = new RGA('A');
    const b = new RGA('B');

    const base = a.localInsert(0, 'abc');
    for (const op of base) b.applyRemote(op);

    const delOp = a.localDelete(1); // A deletes 'b'
    const insOps = b.localInsert(2, 'X'); // B concurrently inserts after 'b' (before applying A's delete)

    if (delOp) b.applyRemote(delOp);
    for (const op of insOps) a.applyRemote(op);

    // The property that actually matters for a CRDT is convergence, not which
    // exact ordering "wins" — that's an implementation-defined tie-break.
    // Here, 'c' was created (clock 3) before the concurrent 'X' (clock 1 on
    // its own site), so the id total order deterministically places 'c'
    // before 'X' on both replicas: "acX". A different tie-break rule could
    // legitimately produce "aXc" instead — what must never happen is A and B
    // disagreeing with each other.
    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('acX');
  });

  test('deleting the same character on two replicas concurrently is idempotent', () => {
    const a = new RGA('A');
    const b = new RGA('B');
    const base = a.localInsert(0, 'hi');
    for (const op of base) b.applyRemote(op);

    const delA = a.localDelete(0);
    const delB = b.localDelete(0);

    if (delB) a.applyRemote(delB); // A sees B's delete of the same (already-deleted) char
    if (delA) b.applyRemote(delA);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('i');
  });
});

describe('RGA — robustness to out-of-order delivery', () => {
  test('an insert op arriving before its own origin character is buffered and applied correctly once the origin arrives', () => {
    const a = new RGA('A');
    const b = new RGA('B');

    const ops = a.localInsert(0, 'abc'); // 3 chained ops: 'a' <- 'b' <- 'c'
    // Deliver to B in REVERSE order: 'c' (depends on 'b') arrives first,
    // then 'b' (depends on 'a'), then 'a' (depends on nothing).
    for (const op of [...ops].reverse()) b.applyRemote(op);

    expect(b.toString()).toBe('abc');
    expect(b.toString()).toBe(a.toString());
  });

  test('a delete arriving before the character it deletes is buffered and applied once that character arrives', () => {
    const a = new RGA('A');
    const b = new RGA('B');
    const insertOps = a.localInsert(0, 'hi');
    const delOp = a.localDelete(0)!; // delete 'h'

    // B receives the delete before it has ever seen 'h' or 'i'.
    b.applyRemote(delOp);
    for (const op of insertOps) b.applyRemote(op);

    expect(b.toString()).toBe(a.toString());
    expect(b.toString()).toBe('i');
  });
});

describe('RGA — snapshot round-trip (how a late-joining client catches up)', () => {
  test('a new replica built from a snapshot matches the source exactly', () => {
    const a = new RGA('A');
    a.localInsert(0, 'hello');
    a.localDelete(0);
    a.localInsert(0, 'H');

    const snapshot = a.toSnapshot();
    const b = RGA.fromSnapshot('B', snapshot);

    expect(b.toString()).toBe(a.toString());

    // B should also be able to keep editing without clock collisions with A.
    const ops = b.localInsert(b.length, '!');
    a.applyRemote(ops[0]);
    expect(a.toString()).toBe(b.toString());
  });
});
