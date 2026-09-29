# ADR 0002: Authoritative server, one port, JSON over WebSocket

**Status:** accepted (revisit the wire format at the milestone marked in ROADMAP.md)

## Context
Base Code runs a repository as a development preview. A multiplayer FPS needs low-latency bidirectional
messaging, and any client can be modified by its player.

## Decision
1. **The server is authoritative.** Clients send *intent* (movement commands, "shoot"); the server
   simulates, applies damage, and decides who won. Clients never report positions or hits.
2. **One HTTP server on one port** serves the client (Vite in dev, built files in prod), `/healthz`,
   `/readyz`, and the `/ws` WebSocket. Fewer ports means fewer things to expose or misconfigure, and a
   single origin makes the WebSocket Origin check meaningful.
3. **JSON text frames** for now: easy to debug, and every message passes one validator
   (`src/server/protocol.js`). Binary encoding is a measured optimisation, not a starting point.
4. **Fixed timestep commands** (`INPUT_DT`), with the server ignoring any client-claimed time. That removes
   speed-hacking by faking `dt`.

## Consequences
- Cheating is limited to what the rules allow (e.g. aim assist); teleporting and damage spoofing are impossible.
- Snapshot size grows linearly with players; delta compression is a roadmap item.
- Lag compensation for hit-scan is not implemented yet (shots resolve against current positions).
