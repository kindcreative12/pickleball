import type { WebSocket } from 'ws';
import { BROADCAST_HZ, TICK_DT, TICK_HZ } from '../shared/constants.js';
import type { Mode, ServerMessage } from '../shared/types.js';
import { Game } from './game.js';

interface Member {
  id: string;
  socket: WebSocket;
}

/**
 * A room owns one Game and the sockets watching it. Rooms hold a variable
 * number of players per side, so doubles needs no change to the netcode.
 */
export class Room {
  readonly code: string;
  readonly game: Game;
  private members: Member[] = [];
  private loop: NodeJS.Timeout | null = null;
  private sinceBroadcast = 0;

  constructor(code: string, mode: Mode) {
    this.code = code;
    this.game = new Game(mode);
  }

  get size(): number {
    return this.members.length;
  }

  join(id: string, name: string, socket: WebSocket): void {
    this.members.push({ id, socket });
    const side = this.game.addPlayer(id, name);
    send(socket, { t: 'joined', id, room: this.code, mode: this.game.mode, side });
    this.start();
  }

  leave(id: string): void {
    this.members = this.members.filter((m) => m.id !== id);
    this.game.removePlayer(id);
    if (this.members.length === 0) this.stop();
  }

  private start(): void {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  private stop(): void {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  private tick(): void {
    this.game.step(TICK_DT);

    this.sinceBroadcast += TICK_DT;
    if (this.sinceBroadcast < 1 / BROADCAST_HZ) return;
    this.sinceBroadcast = 0;

    const message: ServerMessage = { t: 'state', state: this.game.toState() };
    for (const m of this.members) send(m.socket, message);
  }
}

const rooms = new Map<string, Room>();

export function findOrCreateRoom(code: string, mode: Mode): Room | null {
  let room = rooms.get(code);
  if (!room) {
    room = new Room(code, mode);
    rooms.set(code, room);
  }
  if (room.game.isFull) return null;
  return room;
}

export function dropIfEmpty(room: Room): void {
  if (room.size === 0) rooms.delete(room.code);
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
