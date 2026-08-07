import { joinRoom, selfId } from 'trystero';
import { BROADCAST_HZ, PROTOCOL_VERSION, TICK_DT, TICK_HZ } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import type {
  ClientMessage,
  GameState,
  Input,
  LinkState,
  Mode,
  ServerMessage,
} from '../shared/types.js';

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

  o.onMessage({ t: 'status', state: 'connecting', text: 'Connecting to the server…' });

  sock.addEventListener('open', () => {
    sock.send(JSON.stringify({ t: 'join', room: o.room, name: o.name, mode: o.gameMode }));
    o.onMessage({ t: 'status', state: 'live', text: `Connected to the server, room “${o.room}”.` });
  });
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
  const emit = (state: LinkState, text: string) => o.onMessage({ t: 'status', state, text });

  // The room code doubles as the encryption password, so only people who were
  // told the code can read the signalling traffic.
  const room = joinRoom({ appId: APP_ID, password: o.room }, o.room, {
    onJoinError: ({ error }) => emit('failed', `Matchmaking failed: ${error}`),
  });

  emit('connecting', `Looking for players in “${o.room}”…`);

  /**
   * Peer discovery failing looks exactly like nobody having joined yet, so say
   * the most likely cause out loud rather than leaving an empty court.
   */
  const lonely = setTimeout(() => {
    if (peerIds().length === 0) {
      emit('waiting', `Still alone in “${o.room}” — check you both typed the same room code.`);
    }
  }, 12000);

  const names = new Map<string, string>([[selfId, o.name]]);
  let hostId: string | null = null;
  let game: Game | null = null;
  let loop: ReturnType<typeof setInterval> | null = null;
  let sinceBroadcast = 0;

  const nameAction = room.makeAction('name');
  const inputAction = room.makeAction('input');
  const stateAction = room.makeAction('state');

  /** What we announce to a peer on meeting them: who we are, and what we speak. */
  const greeting = () => ({ name: o.name, v: PROTOCOL_VERSION });

  nameAction.onMessage = (data, ctx) => {
    // An older build sends a bare string here rather than a greeting object,
    // so anything unrecognised is treated as a version we cannot talk to.
    const greet = data as { name?: unknown; v?: unknown } | string;
    const version = typeof greet === 'object' && greet !== null ? greet.v : undefined;

    if (version !== PROTOCOL_VERSION) {
      o.onMessage({
        t: 'error',
        message: 'A player is on a different version. Both reload the page to play.',
      });
      return;
    }

    const name = String((greet as { name?: unknown }).name ?? 'Player');
    names.set(ctx.peerId, name);
    if (isHost() && game) game.rename(ctx.peerId, name);
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

  const describe = () => {
    const count = peerIds().length;
    if (count === 0) return `Alone in “${o.room}” — waiting for someone to join.`;
    return `${count} other player${count > 1 ? 's' : ''} connected · you are ${
      isHost() ? 'hosting' : 'a guest'
    }.`;
  };

  room.onPeerJoin = (peerId) => {
    clearTimeout(lonely);
    void nameAction.send(greeting() as unknown as Parameters<typeof nameAction.send>[0], {
      target: peerId,
    });
    elect();
    if (isHost() && game) game.addPlayer(peerId, names.get(peerId) ?? 'Player');
    emit('live', describe());
  };

  room.onPeerLeave = (peerId) => {
    names.delete(peerId);
    if (isHost() && game) game.removePlayer(peerId);
    elect();
    emit(peerIds().length === 0 ? 'waiting' : 'live', describe());
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
      clearTimeout(lonely);
      stopHosting();
      void room.leave();
    },
  };
}
