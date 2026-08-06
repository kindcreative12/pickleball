# Pickleball

A browser-based, real-time multiplayer pickleball game. Friends join by opening a link and typing the same room code — nothing to install.

> **Status:** initial scaffold. The full game loop is written but has not yet been run end-to-end, so expect the first session to be about fixing what the physics actually does versus what it was meant to do.

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:3000>. Open a second tab (or send the URL to a friend on your network) and join with the same room code to start a match.

| Script | What it does |
| --- | --- |
| `npm start` | Bundles the client and serves the game on port 3000 |
| `npm run dev` | Same, but restarts the server on change |
| `npm run build` | Bundles the client only, into `public/` |
| `npm run typecheck` | Typechecks without emitting |

Set `PORT` to serve somewhere other than 3000.

## Controls

- **WASD** or **arrow keys** — move
- **Shift** (or **Space**) — drive the ball flatter and harder
- Hitting is automatic when the ball comes within paddle reach; holding a direction as you strike aims the shot

## How it fits together

The server owns the simulation. Clients send *intent* — which keys are held — and render whatever state comes back. No physics runs on the client, which is what keeps two players from disagreeing about where the ball is.

```
src/
  shared/    constants and message types imported by both sides
  server/    game.ts (the simulation) · rooms.ts (tick loop) · index.ts (HTTP + WebSocket)
  client/    main.ts (canvas rendering, input) · index.html
```

The simulation runs at 60Hz and broadcasts at 30Hz.

The camera is top-down, so the ball carries an explicit height (`z`) that a shadow conveys: the ball lifts away from its shadow as it rises, and the shadow tightens. Without that, a top-down view gives you no way to read a lob from a drive.

Rooms hold a variable list of players per side rather than hardcoding two, so doubles works through the same netcode as singles.

## Rules modelled

Real pickleball rules that actually change the code:

- **Two-bounce rule** — the return of serve and the third shot must each be played off a bounce
- **Non-volley zone (the kitchen)** — no volleying while standing within 7ft of the net
- **Net, out, and double-bounce faults**

Scoring is rally scoring to 11, win by 2. Real pickleball uses side-out scoring; rally scoring was chosen to keep games short.

## Not built yet

- Serve placement rules (serves must land past the kitchen, diagonally)
- Client-side prediction — movement will feel latency-bound over the internet
- Side-out scoring, player rotation in doubles
- Any deployment config
