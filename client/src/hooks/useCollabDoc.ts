import { useCallback, useEffect, useRef, useState } from 'react';
import { RGA } from '../crdt/rga';
import { diffToOps } from '../crdt/diff';
import type { ServerMessage, PresenceUser } from '../protocol';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface UseCollabDoc {
  text: string;
  users: PresenceUser[];
  mySiteId: string | null;
  connection: ConnectionState;
  /** Call with the textarea's new full value on every change event. */
  onLocalEdit: (newText: string) => void;
  onCursorMove: (index: number | null) => void;
}

/**
 * Owns one document's live connection: the WebSocket, the local RGA replica,
 * and the state React needs to render it. `text` and `users` are the only
 * two pieces of state that trigger a re-render; everything else lives in
 * refs so that fast local typing never reads a stale closure.
 */
export function useCollabDoc(wsUrl: string | null): UseCollabDoc {
  const docRef = useRef<RGA | null>(null);
  const textRef = useRef('');
  const wsRef = useRef<WebSocket | null>(null);

  const [text, setText] = useState('');
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [mySiteId, setMySiteId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const syncText = useCallback(() => {
    const t = docRef.current?.toString() ?? '';
    textRef.current = t;
    setText(t);
  }, []);

  useEffect(() => {
    if (!wsUrl) {
      setConnection('closed');
      return;
    }
    setConnection('connecting');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnection('open');
    ws.onclose = () => setConnection('closed');

    ws.onmessage = (evt) => {
      const msg: ServerMessage = JSON.parse(evt.data);
      switch (msg.type) {
        case 'init':
          docRef.current = RGA.fromSnapshot(msg.siteId, msg.snapshot);
          setMySiteId(msg.siteId);
          setUsers(msg.users);
          syncText();
          break;
        case 'op':
          docRef.current?.applyRemote(msg.op);
          syncText();
          break;
        case 'presence':
          setUsers(msg.users);
          break;
        case 'cursor':
          setUsers((prev) => prev.map((u) => (u.siteId === msg.siteId ? { ...u, cursor: msg.index } : u)));
          break;
      }
    };

    return () => ws.close();
  }, [wsUrl, syncText]);

  const onLocalEdit = useCallback(
    (newText: string) => {
      const doc = docRef.current;
      const ws = wsRef.current;
      if (!doc) return;
      const ops = diffToOps(textRef.current, newText, doc);
      syncText();
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const op of ops) ws.send(JSON.stringify({ type: 'op', op }));
      }
    },
    [syncText]
  );

  const onCursorMove = useCallback((index: number | null) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cursor', index }));
    }
  }, []);

  return { text, users, mySiteId, connection, onLocalEdit, onCursorMove };
}
