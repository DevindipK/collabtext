import { useRef } from 'react';

interface EditorProps {
  value: string;
  onChange: (newText: string) => void;
  onCursorMove: (index: number | null) => void;
}

/**
 * A plain, controlled <textarea>. The CRDT plumbing lives entirely in
 * useCollabDoc / diffToOps — this component doesn't know or care that it's
 * backed by a CRDT, it just reports "here's my new full value" on every
 * change, which is what makes it work correctly with typing, paste, cut,
 * IME input, and undo/redo alike.
 */
export function Editor({ value, onChange, onCursorMove }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function reportCursor() {
    const el = ref.current;
    if (el) onCursorMove(el.selectionStart);
  }

  return (
    <textarea
      ref={ref}
      className="editor"
      value={value}
      spellCheck={false}
      onChange={(e) => {
        onChange(e.target.value);
        reportCursor();
      }}
      onSelect={reportCursor}
      onKeyUp={reportCursor}
      onClick={reportCursor}
      onBlur={() => onCursorMove(null)}
      placeholder="Start typing — open this page in a second browser tab to watch it sync live."
    />
  );
}
