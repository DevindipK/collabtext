import { RGA } from './rga';
import { RGAOp } from './types';

/**
 * Turn a browser <textarea>'s "old value -> new value" transition into CRDT
 * ops, by finding the common prefix and suffix and treating whatever's left
 * in the middle as "delete this, insert that". This is what lets a plain
 * textarea (which only ever hands you a final string, not individual
 * keystrokes) drive a CRDT correctly for typing, backspace, delete, paste,
 * cut, and select-and-replace — without needing a custom contenteditable
 * implementation to intercept every input event.
 */
export function diffToOps(oldText: string, newText: string, rga: RGA): RGAOp[] {
  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;

  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const ops: RGAOp[] = [];

  // Delete back-to-front so earlier indices in the loop stay valid as we go.
  for (let i = endOld - 1; i >= start; i--) {
    const op = rga.localDelete(i);
    if (op) ops.push(op);
  }
  if (endNew > start) {
    ops.push(...rga.localInsert(start, newText.slice(start, endNew)));
  }
  return ops;
}
