export type Side = 'left' | 'right';
export type Mode = 'singles' | 'doubles';

/** What a client reports each tick. Intent only — never positions. */
export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Held to hit flatter and harder at the cost of accuracy. */
  power: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
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
  | { t: 'joined'; id: string; room: string; mode: Mode; side: Side }
  | { t: 'state'; state: GameState }
  | { t: 'error'; message: string };
