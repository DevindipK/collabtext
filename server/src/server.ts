import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { SessionRegistry } from './session';
import { ClientMessage } from './protocol';

const PORT = Number(process.env.PORT) || 4000;
const registry = new SessionRegistry();

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const docId = url.searchParams.get('doc')?.trim() || 'default';
  const name = url.searchParams.get('name')?.trim() || 'Anonymous';
  const siteId = randomUUID();

  const session = registry.getOrCreate(docId);
  session.join(ws, siteId, name);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames rather than crashing the connection
    }
    if (msg.type === 'op') session.handleOp(siteId, msg.op);
    else if (msg.type === 'cursor') session.handleCursor(siteId, msg.index);
  });

  ws.on('close', () => {
    session.leave(siteId);
    registry.cleanup(docId);
  });

  ws.on('error', () => {
    // 'close' still fires after 'error' on the ws library, so cleanup happens there.
  });
});

httpServer.listen(PORT, () => {
  console.log(`collabtext server listening on ws://localhost:${PORT}`);
});
