export type Side = 'left' | 'right';
export type Mode = 'singles' | 'doubles';
export type Spin = 'top' | 'slice';

/** What a client reports each tick. Intent only — never positions. */
export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /**
   * The two swing buttons. Which one you press picks the spin, how long you
   * hold it sets the power, and the direction you were holding when you
   * pressed becomes the shot's aim. Releasing before contact is a feint.
   */
  chargeTop: boolean;
  chargeSlice: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  /**
   * Wind-up, broadcast so opponents can read it and react. Absent when the
   * player is not charging.
   */
  charge?: number; // 0..1
  spin?: Spin;
  /** Locked shot direction, in radians of world heading. */
  aim?: number;
  /**
   * Half-width of the cone the shot may actually land within. It is real
   * inaccuracy, not a display trick: a quick poke sprays and is unreadable,
   * a full wind-up is precise and plainly telegraphed.
   */
  aimSpread?: number;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  /** Positive is topspin, negative is backspin. */
  spin: number;
}

export type Phase = 'waiting' | 'serving' | 'rally' | 'point' | 'gameover';

export interface GameState {
  phase: Phase;
  players: PlayerState[];
  ball: BallState;
  score: Record<Side, number>;
  /** Side that will serve, or is serving, the current point. */
  serving: Side;
  /** Populated during 'point' and 'gameover' to explain what just happened. */
  message: string;
}

export type ClientMessage =
  | { t: 'join'; room: string; name: string; mode: Mode }
  | { t: 'input'; input: Input };

export type ServerMessage =
  // `side` is absent in peer-to-peer play: the host assigns sides, and a peer
  // learns its own from the first state it receives.
  | { t: 'joined'; id: string; room: string; mode: Mode; side?: Side }
  | { t: 'state'; state: GameState }
  | { t: 'error'; message: string };
