import { joinRoom, selfId } from 'trystero';
import { BROADCAST_HZ, TICK_DT, TICK_HZ } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import type { ClientMessage, GameState, Input, Mode, ServerMessage } from '../shared/types.js';

/**
 * Both connection styles look the same to the rest of the client: send intent,
 * receive state. Only the code below knows whether a Node server or a peer is
 * running the simulation.
 */
export interface Transport {
  send(msg: ClientMessage): void;
  close(): void;
}

export interface TransportOptions {
  room: string;
  name: string;
  gameMode: Mode;
  onMessage: (msg: ServerMessage) => void;
}

const APP_ID = 'pickleball-court';

export function createTransport(kind: 'ws' | 'p2p', o: TransportOptions): Transport {
  return kind === 'ws' ? websocketTransport(o) : p2pTransport(o);
}

// --- websocket: a Node server owns the simulation ---------------------------

function websocketTransport(o: TransportOptions): Transport {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}`);

  sock.addEventListener('open', () =>
    sock.send(JSON.stringify({ t: 'join', room: o.room, name: o.name, mode: o.gameMode })),
  );
  sock.addEventListener('message', (e) => o.onMessage(JSON.parse(e.data as string) as ServerMessage));
  sock.addEventListener('close', () => o.onMessage({ t: 'error', message: 'Disconnected' }));

  return {
    send: (msg) => {
      if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
    },
    close: () => sock.close(),
  };
}

// --- peer to peer: one peer owns the simulation -----------------------------

/**
 * There is no server, so somebody has to be authoritative: peers sort their
 * ids and the lowest hosts. Everyone runs the same election on the same set,
 * so they agree without negotiating. If the host leaves, the next-lowest takes
 * over — but it starts a fresh Game, so the score resets. That is the honest
 * cost of having no server to hold the match.
 */
function p2pTransport(o: TransportOptions): Transport {
  // The room code doubles as the encryption password, so only people who were
  // told the code can read the signalling traffic.
  const room = joinRoom({ appId: APP_ID, password: o.room }, o.room);

  const names = new Map<string, string>([[selfId, o.name]]);
  let hostId: string | null = null;
  let game: Game | null = null;
  let loop: ReturnType<typeof setInterval> | null = null;
  let sinceBroadcast = 0;

  const nameAction = room.makeAction('name');
  const inputAction = room.makeAction('input');
  const stateAction = room.makeAction('state');

  nameAction.onMessage = (data, ctx) => {
    names.set(ctx.peerId, String(data));
    if (isHost() && game) game.rename(ctx.peerId, String(data));
  };

  inputAction.onMessage = (data, ctx) => {
    if (isHost() && game) game.setInput(ctx.peerId, data as unknown as Input);
  };

  stateAction.onMessage = (data) => {
    if (!isHost()) o.onMessage({ t: 'state', state: data as unknown as GameState });
  };

  const isHost = () => hostId === selfId;
  const peerIds = () => Object.keys(room.getPeers());

  function elect(): void {
    const next = [selfId, ...peerIds()].sort()[0];
    if (next === hostId) return;
    hostId = next;
    if (isHost()) startHosting();
    else stopHosting();
  }

  function startHosting(): void {
    game = new Game(o.gameMode);
    game.addPlayer(selfId, names.get(selfId) ?? 'Player');
    for (const id of peerIds()) game.addPlayer(id, names.get(id) ?? 'Player');

    stopLoop();
    loop = setInterval(() => {
      if (!game) return;
      game.step(TICK_DT);
      sinceBroadcast += TICK_DT;
      if (sinceBroadcast < 1 / BROADCAST_HZ) return;
      sinceBroadcast = 0;

      const state = game.toState();
      o.onMessage({ t: 'state', state });
      void stateAction.send(state as unknown as Parameters<typeof stateAction.send>[0]);
    }, 1000 / TICK_HZ);
  }

  function stopHosting(): void {
    stopLoop();
    game = null;
  }

  function stopLoop(): void {
    if (loop !== null) clearInterval(loop);
    loop = null;
  }

  room.onPeerJoin = (peerId) => {
    void nameAction.send(o.name, { target: peerId });
    elect();
    if (isHost() && game) game.addPlayer(peerId, names.get(peerId) ?? 'Player');
  };

  room.onPeerLeave = (peerId) => {
    names.delete(peerId);
    if (isHost() && game) game.removePlayer(peerId);
    elect();
  };

  // Alone in the room, we host by default; the election corrects this the
  // moment anyone else arrives.
  elect();
  o.onMessage({ t: 'joined', id: selfId, room: o.room, mode: o.gameMode });

  return {
    send: (msg) => {
      if (msg.t !== 'input') return;
      if (isHost()) game?.setInput(selfId, msg.input);
      else void inputAction.send(msg.input as unknown as Parameters<typeof inputAction.send>[0]);
    },
    close: () => {
      stopHosting();
      void room.leave();
    },
  };
}
