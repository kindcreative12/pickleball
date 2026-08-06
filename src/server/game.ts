import {
  AIR_DRAG,
  BALL_RADIUS,
  BOUNCE_RESTITUTION,
  COURT_LENGTH,
  COURT_WIDTH,
  GRAVITY,
  GROUND_FRICTION,
  HIT_COOLDOWN,
  KITCHEN_DEPTH,
  NET_HEIGHT,
  NET_X,
  PADDLE_MAX_HEIGHT,
  PADDLE_REACH,
  PLAYER_SPEED,
  POINTS_TO_WIN,
  SERVE_DELAY,
  WIN_BY,
} from '../shared/constants.js';
import type { GameState, Input, Mode, Phase, Side } from '../shared/types.js';

const NO_INPUT: Input = { up: false, down: false, left: false, right: false, power: false };

interface Player {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  input: Input;
  cooldown: number;
}

interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The authoritative simulation. One instance per room. Clients never run this —
 * they send intent and render whatever comes back, so the two sides cannot drift.
 */
export class Game {
  readonly mode: Mode;
  readonly capacity: number;

  private players: Player[] = [];
  private ball: Ball = { x: NET_X, y: COURT_WIDTH / 2, z: 0, vx: 0, vy: 0, vz: 0 };
  private phase: Phase = 'waiting';
  private score: Record<Side, number> = { left: 0, right: 0 };
  private serving: Side = 'left';
  private message = 'Waiting for players…';

  /** Counts down to the next serve, or to the reset after a point. */
  private timer = 0;

  // Rally bookkeeping. These drive the two-bounce and non-volley-zone rules.
  private lastHitBy: string | null = null;
  private lastHitSide: Side | null = null;
  private bouncesSinceHit = 0;
  private shotsThisRally = 0;

  constructor(mode: Mode) {
    this.mode = mode;
    this.capacity = mode === 'doubles' ? 4 : 2;
  }

  get isFull(): boolean {
    return this.players.length >= this.capacity;
  }

  get isEmpty(): boolean {
    return this.players.length === 0;
  }

  addPlayer(id: string, name: string): Side {
    const left = this.players.filter((p) => p.side === 'left').length;
    const right = this.players.filter((p) => p.side === 'right').length;
    const side: Side = left <= right ? 'left' : 'right';

    const player: Player = {
      id,
      name,
      side,
      x: 0,
      y: 0,
      input: { ...NO_INPUT },
      cooldown: 0,
    };
    this.players.push(player);
    this.placeForServe(player);

    if (this.players.length >= this.capacity && this.phase === 'waiting') {
      this.beginServe(this.serving);
    }
    return side;
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length < this.capacity && this.phase !== 'gameover') {
      this.phase = 'waiting';
      this.message = 'Waiting for players…';
    }
  }

  setInput(id: string, input: Input): void {
    const player = this.players.find((p) => p.id === id);
    if (player) player.input = input;
  }

  step(dt: number): void {
    for (const p of this.players) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      this.movePlayer(p, dt);
    }

    if (this.phase === 'waiting' || this.phase === 'gameover') return;

    if (this.phase === 'point') {
      this.timer -= dt;
      if (this.timer <= 0) this.beginServe(this.serving);
      return;
    }

    if (this.phase === 'serving') {
      // Hold the ball at the server's paddle until the delay elapses.
      const server = this.players.find((p) => p.side === this.serving);
      if (server) {
        this.ball.x = server.x + (this.serving === 'left' ? 0.6 : -0.6);
        this.ball.y = server.y;
        this.ball.z = 2.2;
      }
      this.timer -= dt;
      if (this.timer <= 0) this.serve();
      return;
    }

    this.stepBall(dt);
    this.checkHits();
  }

  toState(): GameState {
    return {
      phase: this.phase,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        side: p.side,
        x: round(p.x),
        y: round(p.y),
      })),
      ball: { x: round(this.ball.x), y: round(this.ball.y), z: round(this.ball.z) },
      score: { ...this.score },
      serving: this.serving,
      message: this.message,
    };
  }

  // --- movement -------------------------------------------------------------

  private movePlayer(p: Player, dt: number): void {
    const dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    const dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;

    const len = Math.hypot(dx, dy);
    p.x += (dx / len) * PLAYER_SPEED * dt;
    p.y += (dy / len) * PLAYER_SPEED * dt;

    // Players are confined to their own half but may range a little off-court
    // to chase wide balls.
    if (p.side === 'left') p.x = clamp(p.x, -4, NET_X - 0.5);
    else p.x = clamp(p.x, NET_X + 0.5, COURT_LENGTH + 4);
    p.y = clamp(p.y, -4, COURT_WIDTH + 4);
  }

  // --- ball -----------------------------------------------------------------

  private stepBall(dt: number): void {
    const b = this.ball;
    const priorX = b.x;

    const drag = Math.max(0, 1 - AIR_DRAG * dt);
    b.vx *= drag;
    b.vy *= drag;

    b.vz -= GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    // Did it cross the net plane this tick, and was it high enough?
    if ((priorX - NET_X) * (b.x - NET_X) < 0) {
      const t = (NET_X - priorX) / (b.x - priorX);
      const zAtNet = b.z - b.vz * dt * (1 - t);
      if (zAtNet < NET_HEIGHT && Math.abs(b.y - COURT_WIDTH / 2) < COURT_WIDTH / 2 + 0.5) {
        this.faultAgainst(this.lastHitSide, 'Into the net');
        return;
      }
    }

    if (b.z <= BALL_RADIUS && b.vz < 0) {
      b.z = BALL_RADIUS;
      b.vz = -b.vz * BOUNCE_RESTITUTION;
      const keep = Math.pow(GROUND_FRICTION, dt * 60);
      b.vx *= keep;
      b.vy *= keep;
      this.onBounce();
    }
  }

  private onBounce(): void {
    const b = this.ball;
    const inBounds =
      b.x >= 0 && b.x <= COURT_LENGTH && b.y >= 0 && b.y <= COURT_WIDTH;

    if (!inBounds) {
      this.faultAgainst(this.lastHitSide, 'Out');
      return;
    }

    const landedOn: Side = b.x < NET_X ? 'left' : 'right';

    // A ball that bounces on the hitter's own side never made it over.
    if (this.lastHitSide && landedOn === this.lastHitSide) {
      this.faultAgainst(this.lastHitSide, 'Did not cross');
      return;
    }

    this.bouncesSinceHit += 1;
    if (this.bouncesSinceHit >= 2) {
      this.awardPoint(other(landedOn), 'Two bounces');
    }
  }

  // --- striking -------------------------------------------------------------

  private checkHits(): void {
    const b = this.ball;
    const ballSide: Side = b.x < NET_X ? 'left' : 'right';

    let best: Player | null = null;
    let bestDist = Infinity;

    for (const p of this.players) {
      if (p.side !== ballSide) continue;
      if (p.cooldown > 0) continue;
      if (p.id === this.lastHitBy && this.bouncesSinceHit === 0) continue;
      if (b.z > PADDLE_MAX_HEIGHT) continue;

      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < PADDLE_REACH && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }

    if (best) this.hit(best);
  }

  private hit(p: Player): void {
    const b = this.ball;
    const isVolley = this.bouncesSinceHit === 0;

    // The two-bounce rule: the return of serve and the third shot must each be
    // played off a bounce.
    if (isVolley && this.shotsThisRally >= 1 && this.shotsThisRally <= 2) {
      this.faultAgainst(p.side, 'Volleyed before the two-bounce rule allows');
      return;
    }

    // The non-volley zone: you may not volley while standing in the kitchen.
    if (isVolley && this.inKitchen(p)) {
      this.faultAgainst(p.side, 'Volley in the kitchen');
      return;
    }

    const dirX = p.side === 'left' ? 1 : -1;
    const speed = p.input.power ? 34 : 26;
    const aimBias = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    const vy = clamp((b.y - p.y) * 3 + aimBias * 6, -15, 15);

    b.vx = dirX * speed;
    b.vy = vy;
    b.vz = this.loftToClearNet(speed, p.input.power ? 0.5 : 1.3);

    p.cooldown = HIT_COOLDOWN;
    this.lastHitBy = p.id;
    this.lastHitSide = p.side;
    this.bouncesSinceHit = 0;
    this.shotsThisRally += 1;
  }

  /** Vertical velocity that puts the ball `margin` feet over the net. */
  private loftToClearNet(speed: number, margin: number): number {
    const b = this.ball;
    const dist = Math.abs(NET_X - b.x);
    const t = Math.max(0.05, dist / speed);
    const vz = (NET_HEIGHT + margin - b.z + 0.5 * GRAVITY * t * t) / t;
    return clamp(vz, 4, 24);
  }

  private inKitchen(p: Player): boolean {
    return p.side === 'left'
      ? p.x > NET_X - KITCHEN_DEPTH
      : p.x < NET_X + KITCHEN_DEPTH;
  }

  // --- points ---------------------------------------------------------------

  private serve(): void {
    const server = this.players.find((p) => p.side === this.serving);
    if (!server) return;

    const b = this.ball;
    b.x = server.x + (this.serving === 'left' ? 0.6 : -0.6);
    b.y = server.y;
    b.z = 2.2;

    const dirX = this.serving === 'left' ? 1 : -1;
    const speed = 22;
    b.vx = dirX * speed;
    b.vy = clamp((COURT_WIDTH / 2 - server.y) * 0.8, -6, 6);
    b.vz = this.loftToClearNet(speed, 2.4);

    this.phase = 'rally';
    this.message = '';
    this.lastHitBy = server.id;
    this.lastHitSide = this.serving;
    this.bouncesSinceHit = 0;
    this.shotsThisRally = 1;
  }

  private beginServe(side: Side): void {
    if (this.players.length < this.capacity) {
      this.phase = 'waiting';
      this.message = 'Waiting for players…';
      return;
    }
    this.serving = side;
    this.phase = 'serving';
    this.timer = SERVE_DELAY;
    this.message = `${side === 'left' ? 'Left' : 'Right'} to serve`;
    for (const p of this.players) this.placeForServe(p);
  }

  private placeForServe(p: Player): void {
    const mates = this.players.filter((q) => q.side === p.side);
    const index = Math.max(0, mates.indexOf(p));
    const lane = mates.length > 1 ? (index === 0 ? 0.3 : 0.7) : 0.5;
    p.x = p.side === 'left' ? 3 : COURT_LENGTH - 3;
    p.y = COURT_WIDTH * lane;
  }

  /** A fault by `side` gives the point to their opponent. */
  private faultAgainst(side: Side | null, reason: string): void {
    if (!side) return;
    this.awardPoint(other(side), reason);
  }

  private awardPoint(side: Side, reason: string): void {
    this.score[side] += 1;
    this.ball.vx = this.ball.vy = this.ball.vz = 0;

    const mine = this.score[side];
    const theirs = this.score[other(side)];
    if (mine >= POINTS_TO_WIN && mine - theirs >= WIN_BY) {
      this.phase = 'gameover';
      this.message = `${side === 'left' ? 'Left' : 'Right'} wins ${mine}–${theirs}`;
      return;
    }

    this.phase = 'point';
    this.timer = 1.5;
    this.serving = side;
    this.message = `${reason} — point to ${side === 'left' ? 'left' : 'right'}`;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
