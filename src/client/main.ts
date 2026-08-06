import {
  COURT_LENGTH,
  COURT_WIDTH,
  KITCHEN_DEPTH,
  NET_X,
} from '../shared/constants.js';
import type {
  ClientMessage,
  GameState,
  Input,
  Mode,
  ServerMessage,
  Side,
} from '../shared/types.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const menu = document.getElementById('menu') as HTMLDivElement;
const form = document.getElementById('join') as HTMLFormElement;
const errorBox = document.getElementById('error') as HTMLDivElement;
const scoreBox = document.getElementById('score') as HTMLDivElement;
const messageBox = document.getElementById('message') as HTMLDivElement;

const MARGIN = 46;
const SCALE = (canvas.width - MARGIN * 2) / COURT_LENGTH;
const OFFSET_Y = (canvas.height - COURT_WIDTH * SCALE) / 2;

/** Court feet -> canvas pixels. */
const px = (x: number) => MARGIN + x * SCALE;
const py = (y: number) => OFFSET_Y + y * SCALE;

let socket: WebSocket | null = null;
let selfId: string | null = null;
let selfSide: Side = 'left';
let state: GameState | null = null;

const input: Input = { up: false, down: false, left: false, right: false, power: false };

// --- input ------------------------------------------------------------------

const KEYS: Record<string, keyof Input> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'power',
  ShiftRight: 'power',
  Space: 'power',
};

function setKey(code: string, down: boolean): void {
  const key = KEYS[code];
  if (!key) return;
  input[key] = down;
}

addEventListener('keydown', (e) => {
  if (KEYS[e.code]) e.preventDefault();
  setKey(e.code, true);
});
addEventListener('keyup', (e) => setKey(e.code, false));
addEventListener('blur', () => {
  for (const k of Object.keys(input) as (keyof Input)[]) input[k] = false;
});

/**
 * Input goes up on a fixed cadence rather than per keypress: the server is
 * authoritative and samples intent each tick, so a steady stream is what it wants.
 */
setInterval(() => {
  send({ t: 'input', input });
}, 1000 / 30);

// --- connection -------------------------------------------------------------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = (document.getElementById('name') as HTMLInputElement).value || 'Player';
  const room = (document.getElementById('room') as HTMLInputElement).value || 'court';
  const mode = (document.getElementById('mode') as HTMLSelectElement).value as Mode;
  connect(name, room, mode);
});

function connect(name: string, room: string, mode: Mode): void {
  errorBox.textContent = '';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}`);

  socket.addEventListener('open', () => send({ t: 'join', room, name, mode }));
  socket.addEventListener('close', () => {
    menu.style.display = 'grid';
    errorBox.textContent = 'Disconnected';
  });
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data as string) as ServerMessage;
    if (msg.t === 'joined') {
      selfId = msg.id;
      selfSide = msg.side;
      menu.style.display = 'none';
    } else if (msg.t === 'state') {
      state = msg.state;
    } else if (msg.t === 'error') {
      errorBox.textContent = msg.message;
      socket?.close();
    }
  });
}

function send(msg: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

// --- rendering --------------------------------------------------------------

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCourt();

  if (state) {
    for (const p of state.players) drawPlayer(p.x, p.y, p.side, p.id === selfId, p.name);
    drawBall(state.ball.x, state.ball.y, state.ball.z);
    scoreBox.textContent = `${state.score.left} — ${state.score.right}`;
    messageBox.textContent = state.message;
  }

  requestAnimationFrame(draw);
}

function drawCourt(): void {
  ctx.fillStyle = '#2f7d5b';
  ctx.fillRect(px(0), py(0), COURT_LENGTH * SCALE, COURT_WIDTH * SCALE);

  // The kitchen reads as a lighter band on each side of the net.
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(px(NET_X - KITCHEN_DEPTH), py(0), KITCHEN_DEPTH * SCALE, COURT_WIDTH * SCALE);
  ctx.fillRect(px(NET_X), py(0), KITCHEN_DEPTH * SCALE, COURT_WIDTH * SCALE);

  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px(0), py(0), COURT_LENGTH * SCALE, COURT_WIDTH * SCALE);

  // Service-court centre lines, outside the kitchen only.
  line(px(0), py(COURT_WIDTH / 2), px(NET_X - KITCHEN_DEPTH), py(COURT_WIDTH / 2));
  line(px(NET_X + KITCHEN_DEPTH), py(COURT_WIDTH / 2), px(COURT_LENGTH), py(COURT_WIDTH / 2));
  line(px(NET_X - KITCHEN_DEPTH), py(0), px(NET_X - KITCHEN_DEPTH), py(COURT_WIDTH));
  line(px(NET_X + KITCHEN_DEPTH), py(0), px(NET_X + KITCHEN_DEPTH), py(COURT_WIDTH));

  // Net.
  ctx.strokeStyle = '#e8eeeb';
  ctx.lineWidth = 5;
  line(px(NET_X), py(-0.6), px(NET_X), py(COURT_WIDTH + 0.6));
  ctx.lineWidth = 2;
}

function line(x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawPlayer(x: number, y: number, side: Side, isSelf: boolean, name: string): void {
  const r = 0.9 * SCALE;
  ctx.beginPath();
  ctx.arc(px(x), py(y), r, 0, Math.PI * 2);
  ctx.fillStyle = side === 'left' ? '#4aa3ff' : '#ffb648';
  ctx.fill();

  if (isSelf) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.lineWidth = 2;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, px(x), py(y) - r - 6);
}

/**
 * Height is the one thing a top-down camera cannot show directly, so the ball
 * lifts away from a shadow that stays on the ground and tightens as it rises.
 */
function drawBall(x: number, y: number, z: number): void {
  const shadowX = px(x);
  const shadowY = py(y);
  const lift = z * SCALE * 0.38;

  ctx.beginPath();
  ctx.ellipse(shadowX, shadowY, 0.34 * SCALE, 0.2 * SCALE, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.34 - z * 0.03)})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(shadowX, shadowY - lift, (0.3 + z * 0.012) * SCALE, 0, Math.PI * 2);
  ctx.fillStyle = '#f5e663';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();
}

draw();
