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

/**
 * Hole punching fails outright behind carrier-grade NAT, which is what mobile
 * networks use: the two peers exchange SDP, agree on everything, and still
 * cannot reach each other. STUN alone cannot fix that. A TURN relay forwards
 * their packets instead — no longer peer-to-peer, and it costs the relay
 * bandwidth, but it is the only thing that connects from such a network.
 *
 * These are Open Relay's free shared credentials, which means they are rate
 * limited and shared with the entire internet. If connections turn flaky, the
 * fix is your own credentials (free, 20GB/month from metered.ca) or a coturn
 * box near the players — for Singapore that is single-digit milliseconds away.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    // Only port 80 answers on this host — 443 is closed, so URLs pointing there
    // just burn gathering time. The TCP variant matters: plenty of mobile
    // networks drop UDP to unusual ports entirely.
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:80?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function createTransport(kind: 'ws' | 'p2p', o: TransportOptions): Transport {
  return kind === 'ws' ? websocketTransport(o) : p2pTransport(o);
}

/**
 * Asks the browser to gather relay candidates and nothing else. If one arrives
 * the TURN server is reachable and the credentials are good; if none does,
 * relaying is unavailable and any peer who cannot be reached directly will
 * fail. Answerable from a single device, which beats coordinating two phones
 * to find out.
 */
export function probeRelay(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let pc: RTCPeerConnection;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        pc.close();
      } catch {
        // already gone
      }
      resolve(ok);
    };

    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: 'relay' });
    } catch {
      resolve(false);
      return;
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && e.candidate.candidate.includes(' typ relay')) finish(true);
    };
    pc.createDataChannel('probe');
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(false));

    setTimeout(() => finish(false), 8000);
  });
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
  const room = joinRoom(
    { appId: APP_ID, password: o.room, rtcConfig: { iceServers: ICE_SERVERS } },
    o.room,
    {
      onJoinError: ({ error }) =>
        emit('failed', `Could not reach the other player, even via relay. ${error}`),
    },
  );

  emit('connecting', `Looking for players in “${o.room}”…`);

  // Say up front if relaying is unavailable, rather than after a peer arrives
  // and the connection mysteriously fails.
  void probeRelay().then((ok) => {
    if (!ok && peerIds().length === 0) {
      emit(
        'waiting',
        `Looking for players in “${o.room}”… Relay unavailable, so this will only work if a direct connection is possible — mobile data often is not.`,
      );
    }
  });

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

  /**
   * Whether ICE settled on a direct path or fell back to the relay. Worth
   * surfacing: a relayed game is slower and spends someone's bandwidth, so it
   * should not be a silent outcome.
   */
  async function pathKind(peerId: string): Promise<string> {
    const pc = room.getPeers()[peerId];
    if (!pc) return '';
    try {
      // RTCStatsReport is a Map at runtime, but the DOM types do not say so.
      const stats = (await pc.getStats()) as unknown as Map<string, Record<string, string>>;
      const pair = [...stats.values()].find(
        (r) => r.type === 'candidate-pair' && r.state === 'succeeded',
      );
      if (!pair) return '';
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      return relayed ? 'through a relay' : 'directly';
    } catch {
      return '';
    }
  }

  function reportLink(): void {
    emit('live', describe());
    const [first] = peerIds();
    if (!first) return;
    void pathKind(first).then((kind) => {
      if (kind && peerIds().length > 0) emit('live', `${describe()} Connected ${kind}.`);
    });
  }

  room.onPeerJoin = (peerId) => {
    clearTimeout(lonely);
    void nameAction.send(greeting() as unknown as Parameters<typeof nameAction.send>[0], {
      target: peerId,
    });
    elect();
    if (isHost() && game) game.addPlayer(peerId, names.get(peerId) ?? 'Player');
    reportLink();
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
