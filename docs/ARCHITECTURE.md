# Architecture

```
 Browser (src/client)                    Node (src/server)
 ┌──────────────────────┐   WebSocket    ┌───────────────────────────────┐
 │ Input -> commands     │  JSON, /ws    │ server.js  (I/O shell)         │
 │ predict with          │ ───────────►  │   origin check, rate limits    │
 │  shared/movement.js   │               │   protocol.js (validate)       │
 │ Three.js scene, HUD   │ ◄───────────  │ GameRoom.js (pure simulation)  │
 │ interpolate others    │  snapshots    │   uses shared/movement+hitscan │
 └──────────────────────┘   30 Hz        └───────────────────────────────┘
            └──────────── src/shared: the deterministic simulation core ───────────┘
```

## Layers and their rules
| Directory | Responsibility | May import |
|---|---|---|
| `src/shared/` | Deterministic simulation core: constants, map, movement, hit-scan, combat, projectile. No I/O, no clock, no randomness. | itself only |
| `src/server/` | Rules and I/O. Pure logic (`GameRoom`, `protocol`, `security`, `rateLimit`, `config`, `logger`, `static`) is separate from the I/O shell (`server.js`, `index.js`). | `shared` |
| `src/client/` | Rendering, input, prediction, HUD. | `shared` |

`src/client` must never import `src/server` and vice versa. That one rule is what keeps the core swappable
(ADR 0001) and the server authoritative (ADR 0002).

## Networking model
- Client sends **commands** at 60 Hz: `{ seq, fwd, right, jump, yaw, pitch }`. Each is one fixed step.
- The server consumes at most 4 per tick, ignores any client timing, and reports `ack = lastSeq` in each snapshot.
- The client re-applies unacknowledged commands on top of the server state (reconciliation), so its own
  movement feels instant while staying correct.
- Other players are rendered ~100 ms in the past, interpolating between two snapshots.
- Shots are resolved server-side against current positions (no lag compensation yet).
- Combat (SPEC §15, D-010–D-015): `shared/combatData.js` holds tuning as data, `shared/combat.js` resolves
  hit zones, range bands and the one damage function, `shared/projectile.js` simulates the grenade at 120 Hz
  sub-steps. Clients send intent only (`shoot`, `throw`); the server replies with a per-shot `verdict`,
  a `boom` per explosion, and a `nades` list in every snapshot.

### Server -> client messages
| Message | To | Shape |
|---|---|---|
| `welcome` | joiner | `{ id, tickRate }` |
| `snap` | everyone | `{ tick, ack, players: [...], nades: [{ id, x, y, z }] }` |
| `shot` | everyone | `{ id, from, to }` |
| `hit` | shooter | `{ id }` |
| `verdict` | shooter | `{ target, zone, dmg, dist, kill }` (also on a miss) |
| `boom` | everyone | `{ id, owner, at, hits: [{ id, dmg, kill }] }` |
| `kill` | everyone | `{ killer, victim, killerName, victimName }` |

Client combat UI: `combatLog.js` (pure, bounded log and formatting), `combatHud.js` (DOM), `grenades.js`
(renders `nades` and explosions), `debugHarness.js` (`?debug=1` only).

## Hosted deployment (Base44, D-017)
```
browser  --https-->  Base44 hosting (dist/ from Vite)
browser  --wss---->  Match actor (Durable Object, one per room id)  ->  MatchSession  ->  GameRoom
```
`src/client/game.js` picks `ActorNetwork` when `VITE_BASE44_APP_ID` is set at build time, otherwise the raw
`/ws` transport. The actor folder contains generated copies of `src/shared` and the `GameRoom` closure
(`base44/tools/sync-actor.mjs`); `src/` stays the single place to edit. See ADR 0004.

## Operational endpoints
`GET /healthz` liveness, `GET /readyz` readiness (+ player count), `WS /ws` game.

## Configuration (environment)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | listen port (1-65535, invalid values abort startup) |
| `HOST` | 0.0.0.0 | bind address |
| `NODE_ENV` | - | `production` serves `dist/` with a strict CSP; otherwise Vite dev middleware |
| `ALLOWED_ORIGINS` | (same-origin) | comma-separated exact origins allowed to open `/ws` |
| `LOG_LEVEL` | info | `debug`, `info`, `warn`, `error` |
