# Roadmap

Order matters: each phase ends green (`npm run verify`, CodeQL clean) before the next starts. Every item
starts with a `docs/SPEC.md` change and failing tests.

## Phase 0 - Foundation (this scaffold)
Authoritative server, prediction, hit-scan, protocol validation, rate limiting, structured logging,
policy checker, layered tests, CI + CodeQL, ADRs, threat model.

## Milestone 1 combat slice (done 2026-09-30, D-010–D-015)
Pulled forward from Phase 2 by the owner: five hit zones, rifle range bands (25/22/18), one grenade with
self-damage and cover, server verdicts and a bounded combat log. Still open from it: lag compensation must
rewind zone geometry (Phase 1), delta snapshots before 60/120 Hz ticks (D-003, D-006).

## Phase 0.5 - TypeScript migration (after the test suites are merged)
Types-only, no build step, refactor-only PRs guarded by the existing tests. Plan and exit criteria:
`docs/adr/0003-typescript-migration.md`.

## Phase 1 - Netcode hardening
- Lag compensation for hit-scan (rewind by client latency, capped).
- Reconnect tokens (128-bit random) and graceful disconnect handling.
- Delta snapshots, then a binary wire format **only after** measuring bandwidth.
- Smooth reconciliation error correction (blend instead of snap).
- Clock sync / RTT estimate for HUD and lag compensation.

## Phase 2 - Gameplay
- Weapons table (rifle, shotgun, sniper) with ammo, reload, spread, recoil.
- ~~Headshot hitbox (split the AABB), damage falloff.~~ Done in the milestone 1 combat slice.
- Pickups, respawn logic by safest spawn, spawn protection.
- Game modes: deathmatch with match timer, then team deathmatch.
- Movement polish: crouch, slide, step-up, air control.

## Phase 3 - Rooms and lobby
- Multiple `GameRoom` instances, lobby list, matchmaking by capacity.
- Per-room tick scheduling; measure tick budget (see stress tests).
- Room-level metrics on `/readyz`.

## Phase 4 - Content
- glTF maps and character models, animation, audio, particle effects.
- Map format loaded from data (validated like any other untrusted input).

## Phase 5 - Persistence and accounts
- Accounts with server-side sessions (large random ids, `HttpOnly` cookies, CSRF protection).
- Leaderboards / stats store. Decide the backend deliberately; do not couple the simulation to it.
  Option: Base44 entities via the SDK (as a standard Base44 app like smartcart does: `base44/` with
  `entities`, `functions`, `agents`). Only for slow, non-realtime data; the game loop stays on our own
  Node server because Base44 backend functions are serverless with memory/execution limits.

## Phase 6 - Production
- Choose a host that runs a persistent Node process (Base Code is a development preview).
- Deploy job in CI: main-only, gated on green, immutable SHA tags, `/healthz` gate, rollback.
- External uptime monitor, log aggregation, load test at target concurrency.
- Optional: C++/WASM simulation core if profiling justifies it (ADR 0001).

## Standing work
Weekly dependency PRs, monthly independent security review recorded in `docs/HARDENING_REVIEW.md`.
