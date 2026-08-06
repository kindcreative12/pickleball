import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { ClientMessage } from '../shared/types.js';
import { dropIfEmpty, findOrCreateRoom, type Room } from './rooms.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = req.url === '/' || !req.url ? '/index.html' : req.url.split('?')[0];
  const candidates =
    url === '/index.html'
      ? [join(ROOT, 'src/client/index.html')]
      : [join(ROOT, 'public', normalize(url)), join(ROOT, 'src/client', normalize(url))];

  for (const path of candidates) {
    if (!path.startsWith(ROOT)) continue;
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      createReadStream(path).pipe(res);
      return;
    } catch {
      // try the next candidate
    }
  }

  res.writeHead(404).end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  const id = randomUUID();
  let room: Room | null = null;

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (msg.t === 'join') {
      if (room) return;
      const code = (msg.room || 'court').trim().toLowerCase().slice(0, 24);
      const found = findOrCreateRoom(code, msg.mode);
      if (!found) {
        socket.send(JSON.stringify({ t: 'error', message: `Room "${code}" is full` }));
        return;
      }
      room = found;
      room.join(id, (msg.name || 'Player').slice(0, 16), socket);
      return;
    }

    if (msg.t === 'input' && room) {
      room.game.setInput(id, msg.input);
    }
  });

  socket.on('close', () => {
    if (!room) return;
    room.leave(id);
    dropIfEmpty(room);
    room = null;
  });
});

server.listen(PORT, () => {
  console.log(`Pickleball server on http://localhost:${PORT}`);
});
