import { describe, test, expect } from 'vitest';
import { RGA } from './rga';
import { diffToOps } from './diff';

/** Apply a textarea transition and return the resulting RGA text, so tests read as "before -> after". */
function apply(before: string, after: string): string {
  const rga = new RGA('A');
  rga.localInsert(0, before);
  diffToOps(before, after, rga);
  return rga.toString();
}

describe('diffToOps — mirrors real <textarea> edit patterns', () => {
  test('typing a character at the end', () => {
    expect(apply('hi', 'hi!')).toBe('hi!');
  });

  test('typing a character in the middle', () => {
    expect(apply('helo', 'hello')).toBe('hello');
  });

  test('backspace at the end', () => {
    expect(apply('hello', 'hell')).toBe('hell');
  });

  test('delete key removing a character from the middle', () => {
    expect(apply('hello', 'hllo')).toBe('hllo');
  });

  test('pasting a block of text over a selection', () => {
    expect(apply('hello world', 'hello there')).toBe('hello there');
  });

  test('select-all and replace', () => {
    expect(apply('old content', 'new')).toBe('new');
  });

  test('cut (delete a selection, no replacement)', () => {
    expect(apply('hello world', 'hello ')).toBe('hello ');
  });

  test('no-op when old and new text are identical', () => {
    const rga = new RGA('A');
    rga.localInsert(0, 'same');
    const ops = diffToOps('same', 'same', rga);
    expect(ops.length).toBe(0);
    expect(rga.toString()).toBe('same');
  });

  test('the resulting ops, replayed on a second replica, reproduce the exact same text', () => {
    const a = new RGA('A');
    const b = new RGA('B');

    const baseline = a.localInsert(0, 'hello');
    for (const op of baseline) b.applyRemote(op); // both replicas now hold identical text

    const editOps = diffToOps('hello', 'hello, world', a);
    for (const op of editOps) b.applyRemote(op);

    expect(a.toString()).toBe('hello, world');
    expect(a.toString()).toBe(b.toString());
  });
});
