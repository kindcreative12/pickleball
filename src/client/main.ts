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
  PlayerState,
  Side,
  Spin,
} from '../shared/types.js';
import { createTransport, type Transport } from './transport.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const menu = document.getElementById('menu') as HTMLDivElement;
const form = document.getElementById('join') as HTMLFormElement;
const errorBox = document.getElementById('error') as HTMLDivElement;
const scoreBox = document.getElementById('score') as HTMLDivElement;
const messageBox = document.getElementById('message') as HTMLDivElement;
const roomTag = document.getElementById('roomtag') as HTMLDivElement;
const statusBox = document.getElementById('status') as HTMLDivElement;

const MARGIN = 46;
const SCALE = (canvas.width - MARGIN * 2) / COURT_LENGTH;
const OFFSET_Y = (canvas.height - COURT_WIDTH * SCALE) / 2;

/** Court feet -> canvas pixels. */
const px = (x: number) => MARGIN + x * SCALE;
const py = (y: number) => OFFSET_Y + y * SCALE;

let transport: Transport | null = null;
let selfId: string | null = null;
let state: GameState | null = null;

/**
 * Peer-to-peer is the default because it works from static hosting with no
 * server at all. `?transport=ws` selects the Node server instead, which is far
 * easier to debug locally with two tabs.
 */
const TRANSPORT: 'ws' | 'p2p' =
  new URLSearchParams(location.search).get('transport') === 'ws' ? 'ws' : 'p2p';

const input: Input = {
  up: false,
  down: false,
  left: false,
  right: false,
  chargeTop: false,
  chargeSlice: false,
};

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
  // Two swing buttons: which one you press chooses the spin.
  Space: 'chargeTop',
  KeyJ: 'chargeTop',
  ShiftLeft: 'chargeSlice',
  ShiftRight: 'chargeSlice',
  KeyK: 'chargeSlice',
};

function setKey(code: string, down: boolean): void {
  const key = KEYS[code];
  if (!key) return;
  input[key] = down;
}

/**
 * WASD are movement keys and also ordinary letters. While the join form has
 * focus they have to stay letters, or a name containing one of them cannot be
 * typed — the game would swallow the keystroke before the field ever saw it.
 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (KEYS[e.code]) e.preventDefault();
  setKey(e.code, true);
});
// Releases are always honoured, even from a focused field: ignoring one could
// leave a key stuck down if focus moved while it was held.
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

// --- touch controls ---------------------------------------------------------

const touchLayer = document.getElementById('touch') as HTMLDivElement;
const stickZone = document.getElementById('stickzone') as HTMLDivElement;
const stick = document.getElementById('stick') as HTMLDivElement;
const knob = document.getElementById('knob') as HTMLDivElement;
const topBtn = document.getElementById('top') as HTMLButtonElement;
const sliceBtn = document.getElementById('slice') as HTMLButtonElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/** How far the knob travels from the origin, in CSS pixels. */
const STICK_RADIUS = 58;
/** Fraction of that travel that must be exceeded before a direction registers. */
const DEADZONE = 0.3;

let stickPointer: number | null = null;
let stickOrigin = { x: 0, y: 0 };

function clearMovement(): void {
  input.up = input.down = input.left = input.right = false;
}

/**
 * The stick is analog but Input is boolean, matching the keyboard. Crossing the
 * deadzone on both axes at once yields a diagonal, exactly as holding two keys does.
 */
function applyStick(dx: number, dy: number): void {
  const dist = Math.hypot(dx, dy);
  const scale = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
  const kx = dx * scale;
  const ky = dy * scale;
  knob.style.transform = `translate(${kx}px, ${ky}px)`;

  const nx = kx / STICK_RADIUS;
  const ny = ky / STICK_RADIUS;
  input.left = nx < -DEADZONE;
  input.right = nx > DEADZONE;
  input.up = ny < -DEADZONE;
  input.down = ny > DEADZONE;
}

// The stick appears wherever the thumb lands rather than at a fixed spot, so
// there is nothing to aim for before you can start moving.
stickZone.addEventListener('pointerdown', (e) => {
  if (stickPointer !== null) return;
  e.preventDefault();
  stickPointer = e.pointerId;
  stickZone.setPointerCapture(e.pointerId);
  stickOrigin = { x: e.clientX, y: e.clientY };
  stick.style.left = `${e.clientX}px`;
  stick.style.top = `${e.clientY}px`;
  stick.style.opacity = '1';
  applyStick(0, 0);
});

stickZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickPointer) return;
  e.preventDefault();
  applyStick(e.clientX - stickOrigin.x, e.clientY - stickOrigin.y);
});

function releaseStick(e: PointerEvent): void {
  if (e.pointerId !== stickPointer) return;
  stickPointer = null;
  stick.style.opacity = '0';
  knob.style.transform = 'translate(0px, 0px)';
  clearMovement();
}

stickZone.addEventListener('pointerup', releaseStick);
stickZone.addEventListener('pointercancel', releaseStick);

function setCharge(which: 'chargeTop' | 'chargeSlice', on: boolean): void {
  input[which] = on;
  (which === 'chargeTop' ? topBtn : sliceBtn).classList.toggle('on', on);
}

function bindSwing(button: HTMLButtonElement, which: 'chargeTop' | 'chargeSlice'): void {
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    setCharge(which, true);
  });
  button.addEventListener('pointerup', () => setCharge(which, false));
  button.addEventListener('pointercancel', () => setCharge(which, false));
}

bindSwing(topBtn, 'chargeTop');
bindSwing(sliceBtn, 'chargeSlice');

// Backgrounding the tab mid-hold would otherwise leave keys stuck down.
addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearMovement();
    setCharge('chargeTop', false);
    setCharge('chargeSlice', false);
  }
});

if (isTouch) {
  hint.textContent = 'Drag left to move · hold TOP or SLICE to wind up, release early to feint';
}

// --- connection -------------------------------------------------------------

const REJOIN_KEY = 'pickleball:rejoin';
let hasJoined = false;

/**
 * Leaving a Trystero room tears down its matchmaking sockets, and joining
 * again from the same page instance silently never discovers anyone — the
 * court comes up and stays empty forever. Reloading hands us a clean instance.
 * The page is small and cached, so it costs a blink, and the intent is carried
 * across in session storage so the player does not retype anything.
 */
function join(name: string, room: string, mode: Mode): void {
  if (hasJoined) {
    sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ name, room, mode }));
    location.reload();
    return;
  }
  hasJoined = true;
  connect(name, room, mode);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = (document.getElementById('name') as HTMLInputElement).value || 'Player';
  // Normalised the same way on both transports, so "Court " and "court" are
  // the same room. Two people who think they typed the same code must land
  // together, or they sit in separate rooms with nothing to tell them why.
  const room = normaliseRoom((document.getElementById('room') as HTMLInputElement).value);
  const mode = (document.getElementById('mode') as HTMLSelectElement).value as Mode;
  // Drop focus from the form so the first keystroke of the match is a move,
  // not a re-submit of whatever button is still focused.
  (document.activeElement as HTMLElement | null)?.blur();
  join(name, room, mode);
});

const normaliseRoom = (raw: string) => (raw || 'court').trim().toLowerCase().slice(0, 24) || 'court';

function connect(name: string, room: string, mode: Mode): void {
  errorBox.textContent = '';
  transport = createTransport(TRANSPORT, {
    room,
    name,
    gameMode: mode,
    onMessage: (msg) => {
      if (msg.t === 'status') {
        statusBox.textContent = msg.text;
        statusBox.dataset.state = msg.state;
        // A failure before the court is up belongs on the menu, where the
        // player is still looking.
        if (msg.state === 'failed' && menu.style.display !== 'none') {
          errorBox.textContent = msg.text;
        }
      } else if (msg.t === 'joined') {
        selfId = msg.id;
        menu.style.display = 'none';
        roomTag.textContent = `room “${msg.room}”`;
        if (isTouch) touchLayer.hidden = false;
      } else if (msg.t === 'state') {
        state = msg.state;
      } else if (msg.t === 'error') {
        errorBox.textContent = msg.message;
        menu.style.display = 'grid';
        roomTag.textContent = '';
        touchLayer.hidden = true;
        transport?.close();
        transport = null;
      }
    },
  });
}

function send(msg: ClientMessage): void {
  transport?.send(msg);
}

// --- rendering --------------------------------------------------------------

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCourt();

  if (state) {
    // Telegraphs sit under the players so a crowded net does not hide them.
    for (const p of state.players) drawTelegraph(p);
    for (const p of state.players) drawPlayer(p.x, p.y, p.side, p.id === selfId, p.name);
    drawBall(state.ball.x, state.ball.y, state.ball.z, state.ball.spin);
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

const SPIN_INK: Record<Spin, string> = { top: '255,140,90', slice: '120,200,255' };

/**
 * A wind-up is public. The cone is where the shot can actually go, so it is an
 * honest reading rather than a hint: wide while the swing is quick and erratic,
 * narrowing as it loads into something precise and dangerous. Reading one is
 * the whole game — you are choosing whether to commit to covering it.
 */
function drawTelegraph(p: PlayerState): void {
  if (p.charge === undefined || p.aim === undefined || p.spin === undefined) return;

  const ink = SPIN_INK[p.spin];
  const dirX = p.side === 'left' ? 1 : -1;
  // Shot velocity is (dirX·cos, sin), so the on-screen heading is that vector.
  const heading = Math.atan2(Math.sin(p.aim), dirX * Math.cos(p.aim));
  const spread = p.aimSpread ?? 0;
  const reach = (7 + 20 * p.charge) * SCALE;
  const cx = px(p.x);
  const cy = py(p.y);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, reach, heading - spread, heading + spread);
  ctx.closePath();
  ctx.fillStyle = `rgba(${ink},${0.1 + 0.14 * p.charge})`;
  ctx.fill();

  // A ring that closes as the swing loads.
  ctx.beginPath();
  ctx.arc(cx, cy, 1.6 * SCALE, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge);
  ctx.strokeStyle = `rgba(${ink},0.95)`;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineWidth = 2;
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
function drawBall(x: number, y: number, z: number, spin: number): void {
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
  // Rim carries the spin, so you can read what is coming before it bounces.
  const carrying = Math.min(1, Math.abs(spin));
  ctx.strokeStyle =
    carrying < 0.05
      ? 'rgba(0,0,0,0.25)'
      : `rgba(${SPIN_INK[spin > 0 ? 'top' : 'slice']},${0.35 + 0.6 * carrying})`;
  ctx.lineWidth = 1 + 2 * carrying;
  ctx.stroke();
  ctx.lineWidth = 2;
}

draw();

// The page has finished evaluating, which the boot watchdog in index.html is
// waiting to hear: cached HTML can outlive the hashed bundle it points at, and
// a silent 404 would otherwise leave a blank court.
(window as unknown as { __pbBooted?: boolean }).__pbBooted = true;
sessionStorage.removeItem('pickleball:reloaded');

// Carry a rejoin across the reload that `join` performs, so returning to the
// menu and picking another room just works.
const pendingRejoin = sessionStorage.getItem(REJOIN_KEY);
if (pendingRejoin) {
  sessionStorage.removeItem(REJOIN_KEY);
  try {
    const { name, room, mode } = JSON.parse(pendingRejoin) as {
      name: string;
      room: string;
      mode: Mode;
    };
    (document.getElementById('name') as HTMLInputElement).value = name;
    (document.getElementById('room') as HTMLInputElement).value = room;
    (document.getElementById('mode') as HTMLSelectElement).value = mode;
    join(name, room, mode);
  } catch {
    // Malformed intent is not worth failing the page over.
  }
}
