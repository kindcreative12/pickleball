# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-08-06

### Added

- Peer-to-peer play with no server, via WebRTC data channels matched by room code over [Trystero](https://github.com/dmotz/trystero). The room code doubles as the signalling encryption password, so only people given the code can read it; gameplay traffic is DTLS-encrypted between peers by mandate.
- Host election: peers sort their ids and the lowest runs the simulation. Every peer runs the same election over the same set, so they agree without negotiating. If the host leaves the next one takes over, though with a fresh game — the score does not survive.
- `transport.ts`, behind which both connection styles look identical to the rest of the client. `?transport=ws` selects the Node server, which is far easier to debug locally than two phones.
- GitHub Pages workflow publishing `dist/` on every push to `main`.

### Changed

- The simulation moved from `server/game.ts` to `shared/game.ts`. It never had a Node dependency, which is precisely what lets the same code run in a server process or in a peer's browser tab — the port cost nothing.
- Build now emits a self-contained `dist/`, which the Node server also serves, so local testing and the published page run byte-identical output.
- Client script path is relative, since Pages serves a project site from a subpath.

## [0.1.0] — 2026-08-06

### Added

- Touch controls, making the game playable on a phone. A floating stick appears wherever a thumb lands on the left half of the screen — no fixed target to find first — and a hold-to-power button sits bottom right. The stick is analog but resolves to the same boolean directions the keyboard produces, so both input paths feed one code path on the server.
- Landscape prompt on portrait touch devices, where the court would otherwise be too small to read.

### Changed

- Client is laid out for mobile: canvas bounded by viewport height as well as width, 16px form inputs so iOS Safari does not zoom on focus, and page-level scroll/zoom suppressed during play.
- Movement and power reset when the tab is backgrounded, which previously could leave an input stuck on.

## [0.0.0] — 2026-08-06

Initial scaffold. Written but not yet run end-to-end.

### Added

- Server-authoritative simulation (`src/server/game.ts`): ball flight with gravity, drag and bounce; automatic paddle contact within reach; net, out and double-bounce faults; the two-bounce rule and the non-volley zone; rally scoring to 11, win by 2.
- Room system (`src/server/rooms.ts`) holding a variable number of players per side, so singles and doubles share one code path. Simulation ticks at 60Hz, broadcasts at 30Hz.
- HTTP and WebSocket server (`src/server/index.ts`) serving the client and routing join/input messages.
- Canvas client (`src/client/`) with a top-down court, ball height conveyed through a shadow, a join menu for name/room/mode, and a score HUD.
- Constants and message types shared by both sides (`src/shared/`) so the client and server cannot disagree about court geometry or wire format.
- `CLAUDE.md` recording the stack, perspective and player-count decisions made before any code was written.
