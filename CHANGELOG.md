# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
