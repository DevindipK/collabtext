import { RGAChar, RGAOp } from './crdt/types';

export interface PresenceUser {
  siteId: string;
  name: string;
  color: string;
  cursor: number | null;
}

/** Sent once, immediately after a client connects and joins a document. */
export interface InitMessage {
  type: 'init';
  siteId: string;
  snapshot: RGAChar[];
  users: PresenceUser[];
}

/** A client's local edit, or the server relaying someone else's. */
export interface OpMessage {
  type: 'op';
  op: RGAOp;
}

/** Client -> server: "here's where my cursor is now." The server already knows who sent it. */
export interface ClientCursorMessage {
  type: 'cursor';
  index: number | null;
}

/** Server -> clients: relaying whose cursor moved and where. */
export interface ServerCursorMessage {
  type: 'cursor';
  siteId: string;
  index: number | null;
}

/** Server -> all clients whenever someone joins or leaves. */
export interface PresenceMessage {
  type: 'presence';
  users: PresenceUser[];
}

export type ServerMessage = InitMessage | OpMessage | ServerCursorMessage | PresenceMessage;
export type ClientMessage = OpMessage | ClientCursorMessage;
