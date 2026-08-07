# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] — 2026-08-07

### Fixed

- Two real devices could find each other and then fail to connect: SDP exchanged, everything agreed, no link. That is symmetric NAT, which mobile carriers use routinely, and no amount of STUN solves it. A TURN relay is now configured, including TCP and TLS on 443 for networks that block plain UDP.

### Added

- The status line says whether the link ended up direct or relayed. A relayed game is slower and spends someone's bandwidth, so it should not be a silent outcome.

## [0.4.1] — 2026-08-07

### Fixed

- Joining a second room in the same session never connected to anyone. Leaving a room tears down Trystero's matchmaking sockets and the instance could not rebuild them, so the court came up and stayed empty forever with nothing to indicate why. Rejoining now reloads the page for a clean instance, carrying name, room and mode across so nothing is retyped.
- Cached HTML could outlive the hashed bundle it points at, since each deploy deletes the previous one — leaving a blank page and no error. A boot watchdog reloads once if the bundle has not announced itself, and says so plainly rather than looping if that does not help.

### Added

- Connection status in words, colour-coded: looking for players, alone in the room, how many are connected and whether you are hosting, and matchmaking failures. If nobody has appeared after twelve seconds it names the likeliest cause — the two of you typing different room codes — instead of leaving an empty court to interpret.

## [0.4.0] — 2026-08-07

### Fixed

- Every bounce was tested for being in or out, so a rally-winning shot could be scored against the player who hit it: the receiver failed to return, the ball bounced a second time beyond the line, and the point went the wrong way. Only the first bounce decides in or out now — after that a second bounce ends the rally in the hitter's favour wherever it lands.

### Added

- The serve must go cross-court, landing in the service court diagonally opposite and clearing the kitchen line, with faults named for each. The service court alternates as the serving side scores, and both players are positioned accordingly — server in the court they are serving from, receiver in the diagonal one the ball is coming to.
- Serves are aimed into the legal box by default, at a depth that clears the kitchen with margin without amounting to a near-ace.

## [0.3.1] — 2026-08-07

### Fixed

- The game claimed every mapped key globally, so W, A, S, D and space never reached the join form. Two people agreeing on a room code containing any of those letters each typed something different and landed in separate rooms, with nothing on screen to explain why they could not see each other. The default code is `court`, which contains none of them — which is why leaving the field blank always worked and typing a code did not.
- Room codes are normalised identically on both transports, and the room actually joined is now shown during play, so a mismatch is visible rather than silent.

### Changed

- The bundle filename carries a content hash. Pages serves everything with a ten-minute cache and fetches the HTML and script separately, so a fixed name let a browser pair new HTML with a stale script — which in a peer-to-peer game means peers silently disagreeing about the wire format.
- Peers exchange a protocol version on meeting and refuse to play across a mismatch, saying so plainly. Previously two versions connected happily and then misread each other, which looks like the game being broken rather than like two versions meeting.

## [0.3.0] — 2026-08-06

### Added

- Charged swings. Two buttons replace the single power key: which one you press picks the spin, how long you hold sets the power, and the direction held at the moment of pressing becomes the aim — which then locks, so you commit before knowing where the ball will end up. The shot fires at contact rather than on release, because timing a release across a network would have handed the zero-latency host a decisive advantage rather than merely an annoying one.
- Feints. Releasing before contact cancels the swing and costs a moment of recovery, so bluffing is a real choice rather than free.
- Topspin and slice, as Magnus force in flight and as spin-dependent bounce: topspin dips and skids forward, slice floats and sits up.
- Forehand and backhand, derived from where the ball is rather than bound to a button, worth a little reach and power. Footwork earns the better side.
- Wind-ups are broadcast and drawn for everyone: a closing ring tinted by spin, plus a cone showing the shot's real spray. The cone narrows as the charge grows, so power is paid for in information — which is what makes committing, feinting and baiting worth anything.

### Fixed

- Shots aimed only to clear the net, never to land. Struck from near the net that solved to a near-vertical launch which then carried the ball forty feet past the baseline; shots now target a landing point and loft higher only when the net demands it.
- Vertical launch was clamped positive, so a ball standing above net height could not be hit downward — quietly making the smash impossible.
- Holding a swing button through the end of a point locked the player out of ever charging again, because the rising-edge detector never re-armed.

### Changed

- Aim range narrowed to about 18°. Reaching a corner from the baseline needs roughly 13°, so the previous 49° was less an aim control than a way to miss the court.

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
