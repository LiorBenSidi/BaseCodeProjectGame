# ADR 0004: Base44 as the hosted platform, Match actor as the production transport

- Status: accepted (D-017, 2026-10-03)
- Supersedes: the hosting assumption in ADR 0002 ("one port, one Node process in production") for the
  hosted build only. The Node server remains the development and test transport.

## Context
Roadmap phases 5 and 6 assumed a self-hosted persistent Node process and treated Base44 as a slow-data
backend only, because backend functions are request-scoped. Base44 Actors change that: an actor is a
stateful WebSocket room on a Cloudflare Durable Object with a managed ticker, a verified connection
identity and an SDK client that mints tokens and reconnects. That is the shape `GameRoom` was built for
(ADR 0001: no I/O, no clocks, driven by `tick()`).

The owner wants the project to be a regular Base44 app in his workspace, carrying every decision so far
(D-001 to D-016), with no second copy of the rules drifting on another host.

## Decision
1. The hosted game is a Base44 app: Vite builds the client into `dist/`, `base44 site deploy` serves it;
   `base44/actors/Match/entry.ts` runs the simulation, one instance per room id.
2. One session layer for both transports: `src/server/matchSession.js` owns budgets, strikes, join and
   routing. `server.js` (ws) and `matchHost.js` (actor) are adapters. (`server.js` still carries its original
   inline copy of that logic today; moving it onto `MatchSession` is a behaviour-preserving refactor that gets
   its own PR, guarded by the existing integration and security suites.)
3. The actor folder is self-contained by generation: `base44/tools/sync-actor.mjs` copies `src/shared` and the
   `GameRoom` closure in; a unit test fails on drift. `src/` stays the only place to edit.
4. The client picks the transport at build time from `VITE_BASE44_APP_ID` (injected by `base44 build`).
5. Invariants 1, 2, 3, 5, 6 and 7 of `AGENTS.md` are unchanged. Invariant 4 ("one port") still governs the
   Node server; on Base44 the site and the room are two platform endpoints and no listener is ours.

## Consequences
- Lost on the hosted path: the `Origin` check (`isAllowedOrigin`), the per-IP connection cap and the
  production CSP headers of `server.js`. The platform replaces the first two (connection tokens minted per
  connection, a per-actor connection-attempt limit); response headers for the site are the platform's.
- Frames are JSON text only. The "binary wire format" item of Phase 1 is dropped in favour of delta snapshots.
- A room keeps no state across a wake unless it is persisted. This slice persists nothing: a hibernation or
  eviction mid-match asks players to rejoin and respawns them. Persisting match state at checkpoints is the
  Phase 3 item that replaces it.
- Tick timing is `setTimeout`-driven with at most 3 catch-up ticks. 60 Hz (D-006) and 120 Hz (D-003) stay
  measurements to make, with tick jitter and per-player snapshot bytes as the numbers that decide.
- The 300 connection attempts per minute per actor limit is a platform number to design the lobby around.
- Rooms are placed by Cloudflare near the first joiner and never move (the platform calls `idFromName(room)`
  with no location hint; verified in the bundler's `actor-compat.ts`). Region belongs in the room id, chosen
  by the lobby (Phase 3), never a single global `arena-1` for everyone.
- The platform caps a received WebSocket frame at Cloudflare's 32 MiB and parses it before our code runs. The
  4 KB rule is re-applied in `MatchSession` by measuring the parsed object; the parse cost of a hostile large
  frame is the platform's and is bounded by the per-connection message budget.
- One new runtime dependency, `@base44/sdk` (adds about 43 kB gzip to the client bundle; the three.js chunk is
  the large one either way). Dependency approval is recorded in D-017.

## Exit criteria for the test the owner and the builder agreed on
Measure, on a deployed room with 16 simulated players at 30 Hz and 60 Hz: tick jitter and catch-up count
inside `handleTick`, snapshot bytes per second per player, client RTT. Record the numbers in `docs/DESIGN.md`
under D-006/D-003 before raising `TICK_RATE`.
