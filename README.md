# Pickleball

### ▶ Play: **https://kindcreative12.github.io/pickleball/**

A browser-based, real-time multiplayer pickleball game. Agree on a room code, and you are playing — no account, no install, and no server to run.

> **Status:** playable. Confirmed working desktop-to-mobile over peer-to-peer. Rough edges remain — see [Not built yet](#not-built-yet).

## Playing

Open the link above, pick a room code, and share that code with whoever you want to play. Everyone who enters the same code lands in the same match.

**On a phone there is nothing to install and nothing to run** — open the URL and turn the phone sideways. The game is static files; the code downloads and runs in your browser. `npm` never enters into it.

## Controls

**Desktop**

- **WASD** or **arrow keys** — move
- **Space** — wind up with topspin · **Shift** — wind up with slice

**Mobile** — controls appear once you join, in landscape

- **Drag anywhere on the left half** — move. The stick materialises wherever your thumb lands, so there is nothing to aim for first.
- **TOP / SLICE buttons, bottom right** — hold to wind up

## The swing

Three things come out of two buttons:

- **Which button** picks the spin. Topspin dips hard and kicks forward off the bounce, so you can swing bigger and still land it. Slice floats and sits up, which is awkward to attack.
- **How long you hold** sets the power. The shot fires automatically when the ball reaches you — you are not timing a release, you are deciding how much to commit beforehand.
- **The direction you were holding when you pressed** becomes the aim, and then it **locks**. You commit before you know where the ball will end up.

**Letting go before the ball arrives is a feint.** The wind-up is lost and your paddle needs a moment, so bluffing costs something real.

Not pressing anything still returns the ball as a soft dink, so nobody whiffs for doing nothing.

### Reading your opponent

Every wind-up is drawn on everyone's screen: a ring closing as it loads, tinted by spin, and a cone showing where the shot can go.

The cone is honest — it is the shot's *actual* spray, not a hint. And it **narrows as the charge grows**. A quick poke is erratic but unreadable; a full swing is precise and plainly telegraphed. Power is paid for in information, which is what makes committing early, feinting, and baiting into real decisions.

Taking the ball on your forehand is worth a little reach and power, so footwork earns you the better side.

## Developing

You do not need any of this to play — only to change the game.

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

| Script | What it does |
| --- | --- |
| `npm start` | Builds and serves on port 3000 |
| `npm run dev` | Same, restarting on change |
| `npm run build` | Static build into `dist/` |
| `npm run typecheck` | Typechecks without emitting |

Two transports exist. The default is peer-to-peer, which is what the published page uses. Appending **`?transport=ws`** switches to the bundled Node server instead — much easier to debug with two local tabs, since everything runs in one process you control.

Pushing to `main` rebuilds and redeploys the published page automatically via `.github/workflows/pages.yml`.

## How it fits together

One rule drives the design: **something must own the simulation.** Clients send *intent* — which keys are held — and render whatever state comes back. Nothing simulates locally, so two players cannot disagree about where the ball is.

```
src/
  shared/    constants, message types, and game.ts — the simulation itself
  server/    rooms.ts (tick loop) · index.ts (HTTP + WebSocket)
  client/    main.ts (rendering, input) · transport.ts (ws or p2p) · index.html
```

`shared/game.ts` has no Node dependencies, which is what makes both transports possible: the identical simulation runs in a server process or in a peer's browser tab, unchanged.

The simulation ticks at 60Hz and broadcasts at 30Hz.

The camera is top-down, so the ball carries an explicit height (`z`) that a shadow conveys: the ball lifts away from its shadow as it rises, and the shadow tightens. Without that, a top-down view gives you no way to read a lob from a drive.

Rooms hold a variable list of players per side rather than hardcoding two, so doubles works through the same netcode as singles.

## How the serverless mode works

Browsers cannot find each other unaided. WebRTC needs the two peers to swap connection descriptions first, and that swap has to happen *somewhere* — a room code alone has nothing to look it up against.

[Trystero](https://github.com/dmotz/trystero) handles it by doing matchmaking over public infrastructure (Nostr relays by default). Once peers find each other, gameplay traffic goes directly between them over WebRTC data channels, which are DTLS-encrypted by mandate — no configuration, and nothing in the middle can read it. The room code is also used as the encryption password, so only people given the code can read the signalling.

Then somebody has to be authoritative. Peers sort their ids and **the lowest one hosts**: it runs `Game` and broadcasts state, everyone else sends input. Each peer runs the same election over the same set, so they agree without negotiating.

The costs of that, stated plainly:

- The host plays at zero latency while everyone else eats a round trip.
- The host could cheat, since it owns the simulation.
- If the host leaves, the next-lowest peer takes over with a **fresh game** — the score resets.

## When it will not connect

WebRTC tries a direct connection first, helped by STUN. That fails behind symmetric NAT, which mobile carriers use routinely via CGNAT. The fix is a TURN relay, which forwards packets between peers — real bandwidth, no longer peer-to-peer, and not configured here.

In practice: players on home WiFi or broadband almost always connect directly. Mobile data is a coin flip. If it becomes a problem, `turnConfig` in `src/client/transport.ts` is where a relay would go.

## Rules modelled

Real pickleball rules that actually change the code:

- **Two-bounce rule** — the return of serve and the third shot must each be played off a bounce
- **Non-volley zone (the kitchen)** — no volleying while standing within 7ft of the net
- **Net, out, and double-bounce faults**

Scoring is rally scoring to 11, win by 2. Real pickleball uses side-out scoring; rally scoring was chosen to keep games short.

## Not built yet

- Serve placement rules (serves must land past the kitchen, diagonally)
- Client-side prediction — movement is latency-bound for everyone but the host
- Host migration that preserves the score
- TURN fallback for players behind CGNAT
- Side-out scoring, player rotation in doubles
