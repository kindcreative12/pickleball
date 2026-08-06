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

// --- swing ------------------------------------------------------------------

/** Seconds of holding to reach a full wind-up. */
export const CHARGE_TIME = 1.1;
/** Speed of a shot at zero charge and at full charge. */
export const SHOT_SPEED_MIN = 22;
export const SHOT_SPEED_MAX = 38;
/** Speed of the automatic dink played when nobody pressed anything. */
export const DINK_SPEED = 16;
/**
 * How far either side of straight-ahead a shot can be aimed, in radians.
 * Roughly 18°. Hitting a corner from the baseline only needs about 13°, so
 * anything much wider is not an aim control — it is a way to miss the court.
 */
export const AIM_RANGE = 0.32;
/** Nothing may leave the paddle at a sharper angle than this, spray included. */
export const AIM_LIMIT = 0.5;

/**
 * Accuracy is the price of a quick swing. The shot lands somewhere inside a
 * cone this wide, and everyone can see the cone — so a fast poke is erratic
 * but unreadable, while a loaded smash is precise and obvious.
 */
export const AIM_SPREAD_MAX = 0.22;
export const AIM_SPREAD_MIN = 0.03;

/** Cost of pulling out of a swing, which is what makes a feint a real choice. */
export const FEINT_RECOVERY = 0.18;

/** Taking the ball on your forehand is worth footwork. */
export const FOREHAND_POWER = 1.14;
export const BACKHAND_POWER = 0.88;
export const FOREHAND_REACH = 0.35;

// --- spin -------------------------------------------------------------------

/** Extra downward acceleration per unit of topspin — the Magnus effect. */
export const MAGNUS = 24;
/** Topspin skids forward off the bounce; backspin checks up. */
export const SPIN_KICK = 0.26;
export const SPIN_SIT = 0.3;
/** Fraction of spin shed per second in flight, and kept through a bounce. */
export const SPIN_DECAY = 0.5;
export const SPIN_BOUNCE_KEEP = 0.45;

export const SERVE_DELAY = 1.2; // seconds between point won and next serve
export const POINTS_TO_WIN = 11;
export const WIN_BY = 2;

export const TICK_HZ = 60;
export const BROADCAST_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;
