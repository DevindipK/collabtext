import WebSocket from 'ws';
import { RGA } from './crdt/rga';
import { RGAChar } from './crdt/types';
import { PresenceUser, ServerMessage } from './protocol';

const COLORS = ['#F97362', '#5FA8D3', '#4ADE80', '#FBBF24', '#C084FC', '#F472B6', '#38BDF8'];

interface Member {
  ws: WebSocket;
  siteId: string;
  name: string;
  color: string;
  cursor: number | null;
}

/**
 * One collaboratively-edited document ("room"). Holds the authoritative CRDT
 * state so that a client joining mid-session can be caught up with a single
 * snapshot instead of replaying a full op history.
 */
export class Session {
  readonly docId: string;
  private doc = new RGA('__server__');
  private members = new Map<string, Member>();
  private nextColor = 0;

  constructor(docId: string) {
    this.docId = docId;
  }

  get isEmpty(): boolean {
    return this.members.size === 0;
  }

  private presenceList(): PresenceUser[] {
    return [...this.members.values()].map((m) => ({ siteId: m.siteId, name: m.name, color: m.color, cursor: m.cursor }));
  }

  private broadcast(message: ServerMessage, exceptSiteId?: string): void {
    const payload = JSON.stringify(message);
    for (const m of this.members.values()) {
      if (m.siteId === exceptSiteId) continue;
      if (m.ws.readyState === WebSocket.OPEN) m.ws.send(payload);
    }
  }

  join(ws: WebSocket, siteId: string, name: string): void {
    const color = COLORS[this.nextColor++ % COLORS.length];
    this.members.set(siteId, { ws, siteId, name, color, cursor: null });

    const snapshot: RGAChar[] = this.doc.toSnapshot();
    const init: ServerMessage = { type: 'init', siteId, snapshot, users: this.presenceList() };
    ws.send(JSON.stringify(init));

    this.broadcast({ type: 'presence', users: this.presenceList() }, siteId);
  }

  leave(siteId: string): void {
    this.members.delete(siteId);
    this.broadcast({ type: 'presence', users: this.presenceList() });
  }

  /** Apply an incoming op to the authoritative doc and relay it to everyone else. */
  handleOp(siteId: string, op: import('./crdt/types').RGAOp): void {
    this.doc.applyRemote(op);
    this.broadcast({ type: 'op', op }, siteId);
  }

  handleCursor(siteId: string, index: number | null): void {
    const m = this.members.get(siteId);
    if (!m) return;
    m.cursor = index;
    this.broadcast({ type: 'cursor', siteId, index }, siteId);
  }
}

export class SessionRegistry {
  private sessions = new Map<string, Session>();

  getOrCreate(docId: string): Session {
    let s = this.sessions.get(docId);
    if (!s) {
      s = new Session(docId);
      this.sessions.set(docId, s);
    }
    return s;
  }

  /** Free memory once the last person leaves a document. */
  cleanup(docId: string): void {
    const s = this.sessions.get(docId);
    if (s && s.isEmpty) this.sessions.delete(docId);
  }
}
