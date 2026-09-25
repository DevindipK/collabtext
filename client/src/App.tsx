import { useMemo, useState } from 'react';
import { useCollabDoc } from './hooks/useCollabDoc';
import { Editor } from './components/Editor';
import { PresenceBar } from './components/PresenceBar';

const WS_BASE = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:4000';

function randomDocId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function readDocIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('doc');
}

export default function App() {
  const [docId, setDocId] = useState(() => readDocIdFromUrl() || randomDocId());
  const [name, setName] = useState(() => localStorage.getItem('collabtext-name') || '');
  // Auto-join only when we already know BOTH which document and who they are —
  // a shared link alone should still prompt for a name, not silently join as "Anonymous".
  const [joined, setJoined] = useState(() => Boolean(readDocIdFromUrl()) && Boolean(localStorage.getItem('collabtext-name')));

  const wsUrl = useMemo(() => {
    if (!joined) return null;
    const url = new URL(WS_BASE);
    url.searchParams.set('doc', docId);
    url.searchParams.set('name', name.trim() || 'Anonymous');
    return url.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]); // intentionally frozen at join time — renaming mid-session shouldn't reconnect

  const { text, users, mySiteId, connection, onLocalEdit, onCursorMove } = useCollabDoc(wsUrl);

  function join() {
    localStorage.setItem('collabtext-name', name.trim() || 'Anonymous');
    const url = new URL(window.location.href);
    url.searchParams.set('doc', docId);
    window.history.replaceState({}, '', url.toString());
    setJoined(true);
  }

  function copyShareLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('doc', docId);
    navigator.clipboard.writeText(url.toString()).catch(() => {});
  }

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h1>collabtext</h1>
          <p className="join-sub">A real-time collaborative editor built on a CRDT written from scratch — no coordination, no locks, every replica converges.</p>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Devindip" onKeyDown={(e) => e.key === 'Enter' && join()} />
          </label>
          <label className="field">
            <span>Document</span>
            <input value={docId} onChange={(e) => setDocId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} />
          </label>
          <button className="btn-primary" onClick={join}>
            Join document
          </button>
          <p className="join-hint">Open the same document link in a second tab to see edits sync live.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>collabtext <span className="doc-id">/{docId}</span></h1>
        <div className="app-header__right">
          <button className="btn-ghost" onClick={copyShareLink}>Copy share link</button>
          <PresenceBar users={users} mySiteId={mySiteId} connection={connection} />
        </div>
      </header>
      <Editor value={text} onChange={onLocalEdit} onCursorMove={onCursorMove} />
      <footer className="app-footer">{text.length} characters</footer>
    </div>
  );
}
