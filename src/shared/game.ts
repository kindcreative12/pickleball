import {
  AIM_LIMIT,
  AIM_RANGE,
  AIM_SPREAD_MAX,
  AIM_SPREAD_MIN,
  AIR_DRAG,
  BACKHAND_POWER,
  BALL_RADIUS,
  BOUNCE_RESTITUTION,
  CHARGE_TIME,
  COURT_LENGTH,
  COURT_WIDTH,
  DINK_SPEED,
  FEINT_RECOVERY,
  FOREHAND_POWER,
  FOREHAND_REACH,
  GRAVITY,
  GROUND_FRICTION,
  HIT_COOLDOWN,
  KITCHEN_DEPTH,
  MAGNUS,
  NET_HEIGHT,
  NET_X,
  PADDLE_MAX_HEIGHT,
  PADDLE_REACH,
  PLAYER_SPEED,
  POINTS_TO_WIN,
  SERVE_DELAY,
  SHOT_SPEED_MAX,
  SHOT_SPEED_MIN,
  SPIN_BOUNCE_KEEP,
  SPIN_DECAY,
  SPIN_KICK,
  SPIN_SIT,
  WIN_BY,
} from './constants.js';
import type { GameState, Input, Mode, Phase, Side, Spin } from './types.js';

const NO_INPUT: Input = {
  up: false,
  down: false,
  left: false,
  right: false,
  chargeTop: false,
  chargeSlice: false,
};

/** A swing in progress. Aim and spray are fixed the moment it begins. */
interface Charge {
  spin: Spin;
  held: number;
  aim: number;
  /** Where inside the spray cone this particular shot will actually go. */
  stray: number;
}

interface Player {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  input: Input;
  cooldown: number;
  charge: Charge | null;
  /** Previous frame's button state, so the host can find the rising edge itself. */
  swingHeld: boolean;
}

interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
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
  private ball: Ball = { x: NET_X, y: COURT_WIDTH / 2, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 };
  private phase: Phase = 'waiting';
  private score: Record<Side, number> = { left: 0, right: 0 };
  private serving: Side = 'left';
  /** Which service court the serve is struck from; the target is the diagonal. */
  private serveFromTop = true;
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
      charge: null,
      swingHeld: false,
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

  /** Peers announce their name after connecting, so it can arrive late. */
  rename(id: string, name: string): void {
    const player = this.players.find((p) => p.id === id);
    if (player) player.name = name;
  }

  setInput(id: string, input: Input): void {
    const player = this.players.find((p) => p.id === id);
    if (player) player.input = input;
  }

  step(dt: number): void {
    for (const p of this.players) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      this.updateCharge(p, dt);
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
      players: this.players.map((p) => {
        const t = p.charge ? p.charge.held / CHARGE_TIME : 0;
        return {
          id: p.id,
          name: p.name,
          side: p.side,
          x: round(p.x),
          y: round(p.y),
          // A wind-up is public information — that is the whole point.
          ...(p.charge
            ? {
                charge: round(t),
                spin: p.charge.spin,
                aim: round(p.charge.aim),
                aimSpread: round(spreadFor(t)),
              }
            : {}),
        };
      }),
      ball: {
        x: round(this.ball.x),
        y: round(this.ball.y),
        z: round(this.ball.z),
        spin: round(this.ball.spin),
      },
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

  // --- swing ----------------------------------------------------------------

  /**
   * Charge is timed here, from the stream of button states, rather than trusted
   * from the client — otherwise a peer could simply claim a full wind-up. The
   * cost is that a remote player's charge begins one network trip late, which
   * their own client hides by drawing its own ring from local input.
   */
  private updateCharge(p: Player, dt: number): void {
    const held = p.input.chargeTop || p.input.chargeSlice;

    if (held && !p.swingHeld && !p.charge) {
      // Aim is taken from where they were pushing at this instant and then
      // frozen: you commit before you know where the ball will end up.
      const lateral = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      p.charge = {
        spin: p.input.chargeTop ? 'top' : 'slice',
        held: 0,
        aim: lateral * AIM_RANGE,
        stray: Math.random() * 2 - 1,
      };
    } else if (held && p.charge) {
      p.charge.held = Math.min(CHARGE_TIME, p.charge.held + dt);
    } else if (!held && p.charge) {
      // Let go before the ball arrived — a feint. The wind-up is lost and the
      // paddle needs a moment, so bluffing costs something.
      p.charge = null;
      p.cooldown = Math.max(p.cooldown, FEINT_RECOVERY);
    }

    p.swingHeld = held;
  }

  /** Two right-handers facing each other have forehands on opposite flanks. */
  private isForehand(p: Player): boolean {
    const offset = this.ball.y - p.y;
    return p.side === 'left' ? offset >= 0 : offset <= 0;
  }

  // --- ball -----------------------------------------------------------------

  private stepBall(dt: number): void {
    const b = this.ball;
    const priorX = b.x;

    const drag = Math.max(0, 1 - AIR_DRAG * dt);
    b.vx *= drag;
    b.vy *= drag;

    // Magnus: topspin drags the ball down, which is what lets you swing hard
    // and still land it. Backspin holds it up and floats.
    b.vz -= (GRAVITY + MAGNUS * b.spin) * dt;
    b.spin *= Math.max(0, 1 - SPIN_DECAY * dt);
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

      // Spin trades height for length. Topspin kicks through low and fast;
      // backspin checks up and sits, which is what makes a slice awkward to
      // attack.
      const sit = clamp(1 - SPIN_SIT * b.spin, 0.45, 1.6);
      const kick = clamp(1 + SPIN_KICK * b.spin, 0.6, 1.5);
      b.vz = -b.vz * BOUNCE_RESTITUTION * sit;
      const keep = Math.pow(GROUND_FRICTION, dt * 60) * kick;
      b.vx *= keep;
      b.vy *= keep;
      b.spin *= SPIN_BOUNCE_KEEP;
      this.onBounce();
    }
  }

  private onBounce(): void {
    const b = this.ball;
    const landedOn: Side = b.x < NET_X ? 'left' : 'right';

    // Only the first bounce decides in or out. Once a shot has landed in, the
    // receiver owes a return, and a second bounce ends the rally in the
    // hitter's favour wherever it happens to land — chasing a good shot off
    // the court and letting it bounce again is not a reprieve.
    if (this.bouncesSinceHit >= 1) {
      this.awardPoint(this.lastHitSide ?? other(landedOn), 'Two bounces');
      return;
    }

    const inBounds = b.x >= 0 && b.x <= COURT_LENGTH && b.y >= 0 && b.y <= COURT_WIDTH;
    if (!inBounds) {
      this.faultAgainst(this.lastHitSide, 'Out');
      return;
    }

    // A ball that bounces on the hitter's own side never made it over.
    if (this.lastHitSide && landedOn === this.lastHitSide) {
      this.faultAgainst(this.lastHitSide, 'Did not cross');
      return;
    }

    // The serve carries two extra conditions the rest of the rally does not.
    if (this.shotsThisRally === 1) {
      const clearedKitchen =
        this.serving === 'left' ? b.x > NET_X + KITCHEN_DEPTH : b.x < NET_X - KITCHEN_DEPTH;
      if (!clearedKitchen) {
        this.faultAgainst(this.serving, 'Serve landed in the kitchen');
        return;
      }
      // Cross-court: a serve struck from one service court must land in the
      // one diagonally opposite.
      const landedTop = b.y < COURT_WIDTH / 2;
      if (landedTop === this.serveFromTop) {
        this.faultAgainst(this.serving, 'Serve must go cross-court');
        return;
      }
    }

    this.bouncesSinceHit += 1;
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

      const reach = PADDLE_REACH + (this.isForehand(p) ? FOREHAND_REACH : 0);
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < reach && d < bestDist) {
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

    const charge = p.charge;
    const t = charge ? charge.held / CHARGE_TIME : 0;
    const dirX = p.side === 'left' ? 1 : -1;

    // Reaching for a backhand costs you power; earning a forehand pays.
    const hand = this.isForehand(p) ? FOREHAND_POWER : BACKHAND_POWER;
    const speed = (charge ? SHOT_SPEED_MIN + (SHOT_SPEED_MAX - SHOT_SPEED_MIN) * t : DINK_SPEED) * hand;

    // Where it actually goes: the locked aim, plus however far inside the
    // spray cone this swing happened to land. A full wind-up barely strays.
    const aim = charge
      ? clamp(charge.aim + charge.stray * spreadFor(t), -AIM_LIMIT, AIM_LIMIT)
      : clamp((b.y - p.y) * 0.12, -AIM_RANGE, AIM_RANGE);

    const spin = charge ? (charge.spin === 'top' ? 1 : -1) * (0.4 + 0.6 * t) : 0;

    b.vx = dirX * speed * Math.cos(aim);
    b.vy = speed * Math.sin(aim);
    b.spin = spin;
    // A loaded swing drives deep; an uncharged tap drops short, which is what
    // makes it a dink rather than a weak drive.
    const depth = charge ? 0.5 + 0.32 * t : 0.34;
    b.vz = this.launchToLand(
      this.targetDepth(p.side, depth),
      Math.abs(b.vx),
      GRAVITY + MAGNUS * spin,
    );

    p.charge = null;
    p.cooldown = HIT_COOLDOWN;
    this.lastHitBy = p.id;
    this.lastHitSide = p.side;
    this.bouncesSinceHit = 0;
    this.shotsThisRally += 1;
  }

  /**
   * Vertical velocity that lands the ball at `targetX`, lofting higher only if
   * the net would otherwise stop it.
   *
   * Solving purely for net clearance is what the earlier version did, and it
   * fails badly up close: asked to clear a 3ft net from 3ft away, it returns a
   * near-vertical launch that then carries the ball forty feet past the
   * baseline. Aiming at a landing spot first keeps shots on the court.
   */
  private launchToLand(targetX: number, horizontalSpeed: number, gravity = GRAVITY): number {
    const b = this.ball;
    const speed = Math.max(1, horizontalSpeed);
    const flight = Math.max(0.08, Math.abs(targetX - b.x) / speed);
    let vz = (0.5 * gravity * flight * flight - b.z) / flight;

    const toNet = Math.abs(NET_X - b.x);
    if (toNet > 0.01) {
      const atNet = toNet / speed;
      const height = b.z + vz * atNet - 0.5 * gravity * atNet * atNet;
      const needed = NET_HEIGHT + 0.35;
      if (height < needed) {
        vz = (needed - b.z + 0.5 * gravity * atNet * atNet) / atNet;
      }
    }

    // Downward launches must stay available: a ball standing above net height
    // is exactly the one you want to hit down through the court, and clamping
    // to positive vz would quietly make the smash impossible. The net check
    // above is what stops this from simply burying the ball in the tape.
    return clamp(vz, -22, 34);
  }

  /** Where a shot should land: harder swings are driven deeper. */
  private targetDepth(side: Side, fraction: number): number {
    return side === 'left'
      ? NET_X + fraction * (COURT_LENGTH - NET_X)
      : NET_X - fraction * NET_X;
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

    // Aim well past the kitchen line and into the diagonal service court, so a
    // default serve is legal and the player has to work to miss it.
    // Deep enough to clear the kitchen line with margin, shallow enough that
    // the receiver has a rally to play rather than a near-ace to chase.
    const targetX = this.targetDepth(this.serving, 0.62);
    const targetY = this.serveFromTop ? COURT_WIDTH * 0.72 : COURT_WIDTH * 0.28;
    const flight = Math.max(0.1, Math.abs(targetX - b.x) / speed);

    b.vx = dirX * speed;
    b.vy = clamp((targetY - b.y) / flight, -12, 12);
    b.spin = 0;
    b.vz = this.launchToLand(targetX, speed);

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
    // Real pickleball alternates service courts as the serving side scores.
    this.serveFromTop = this.score[side] % 2 === 0;
    this.phase = 'serving';
    this.timer = SERVE_DELAY;
    this.message = `${side === 'left' ? 'Left' : 'Right'} to serve`;
    for (const p of this.players) {
      // Drop any wind-up carried over from the last point, but re-arm the edge
      // detector: a player still holding the button expects to start charging
      // again, not to be locked out until they let go.
      p.charge = null;
      p.swingHeld = false;
      this.placeForServe(p);
    }
  }

  /**
   * The server stands in the service court they are serving from, and the
   * receiver stands in the diagonal one that the ball is coming to. In doubles
   * the partner takes the other court.
   */
  private placeForServe(p: Player): void {
    const serves = p.side === this.serving;
    const top = serves ? this.serveFromTop : !this.serveFromTop;

    const mates = this.players.filter((q) => q.side === p.side);
    const index = Math.max(0, mates.indexOf(p));
    const inTop = mates.length > 1 && index === 1 ? !top : top;

    p.x = p.side === 'left' ? 3 : COURT_LENGTH - 3;
    p.y = COURT_WIDTH * (inTop ? 0.28 : 0.72);
  }

  /** A fault by `side` gives the point to their opponent. */
  private faultAgainst(side: Side | null, reason: string): void {
    if (!side) return;
    this.awardPoint(other(side), reason);
  }

  private awardPoint(side: Side, reason: string): void {
    this.score[side] += 1;
    this.ball.vx = this.ball.vy = this.ball.vz = this.ball.spin = 0;

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

/**
 * How wide the shot may stray, as a function of wind-up. Wide and unreadable
 * when quick, tight and telegraphed when loaded — power is paid for in
 * information.
 */
const spreadFor = (t: number) => AIM_SPREAD_MAX + (AIM_SPREAD_MIN - AIM_SPREAD_MAX) * t;
