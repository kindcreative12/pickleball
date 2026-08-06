// All distances are in feet, matching a real pickleball court.
// x runs the length of the court (baseline to baseline), y runs the width,
// z is height above the surface. The camera is top-down, so z is conveyed
// to the player through the ball's shadow rather than the ball's position.

export const COURT_LENGTH = 44;
export const COURT_WIDTH = 20;

/** The net sits halfway down the length of the court. */
export const NET_X = COURT_LENGTH / 2;
export const NET_HEIGHT = 2.83; // 34" at centre

/** Non-volley zone ("the kitchen") extends 7ft from the net on each side. */
export const KITCHEN_DEPTH = 7;

export const GRAVITY = 32.2; // ft/s^2
export const BALL_RADIUS = 0.12;
/** Fraction of vertical speed retained on a bounce. */
export const BOUNCE_RESTITUTION = 0.55;
/** Per-second horizontal velocity retained, approximating drag. */
export const GROUND_FRICTION = 0.72;
export const AIR_DRAG = 0.12;

export const PLAYER_SPEED = 14; // ft/s
export const PLAYER_RADIUS = 0.8;
/** How far from the paddle's centre a ball can be struck. */
export const PADDLE_REACH = 2.4;
/** A ball above this height is out of comfortable reach. */
export const PADDLE_MAX_HEIGHT = 7;
/** Seconds a player must wait between strikes. */
export const HIT_COOLDOWN = 0.25;

export const SERVE_DELAY = 1.2; // seconds between point won and next serve
export const POINTS_TO_WIN = 11;
export const WIN_BY = 2;

export const TICK_HZ = 60;
export const BROADCAST_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;
