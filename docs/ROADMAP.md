# Roadmap

Order matters: each phase ends green (`npm run verify`, CodeQL clean) before the next starts. Every item
starts with a `docs/SPEC.md` change and failing tests.

## Base44 app scaffold (done 2026-10-03, D-017)
Site + Match actor + shared session layer (`docs/SPEC.md` §17, ADR 0004). First deploy and the 30/60 Hz
measurement are the next steps.

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
- Delta snapshots (the hosted transport is JSON text only, ADR 0004; no binary format).
- Smooth reconciliation error correction (blend instead of snap).
- Clock sync / RTT estimate for HUD and lag compensation.

## Phase 2 - Gameplay
- ~~Weapons table (rifle, smg, shotgun, sniper, pistol) with ammo, reload, spread, recoil.~~ Done 2026-10-04 (D-019).
- ~~Headshot hitbox (split the AABB), damage falloff.~~ Done in the milestone 1 combat slice.
- ~~Pickups, respawn logic by safest spawn, spawn protection.~~ Done 2026-10-04 (D-020).
- ~~Game modes: deathmatch with match timer, then team deathmatch.~~ Done 2026-10-04 (D-021).
- ~~Movement polish: crouch, slide, step-up, air control.~~ Done 2026-10-04 (D-022), plus sprint, mantle and wall jump.
- ~~Kits with abilities and in-match progression (XP, levels, perks).~~ Done 2026-10-04 (D-023).

## Phase 3 - Rooms and lobby
- Multiple `GameRoom` instances, lobby list, matchmaking by capacity.
- Per-room tick scheduling; measure tick budget (see stress tests).
- Room-level metrics on `/readyz`.

## Phase 4 - Content
- glTF maps and character models, animation, audio, particle effects.
- Map format loaded from data (validated like any other untrusted input).

## Phase 5 - Persistence and accounts (on Base44, D-017)
- Players sign in with the app's auth; the actor reads `conn.identity.userId` (platform-verified) and binds
  the seat, score and progression to it. Anonymous play stays allowed for the slice.
- Leaderboards / stats as Base44 entities, written from the actor through `this.client.asServiceRole` at
  round end (never per tick). Frontend writes stay limited to user-owned records.
- Match state persisted at checkpoints (`this.storage`) so a wake mid-match restores seats instead of
  respawning everyone.

## Phase 6 - Production (on Base44, D-017)
- Production ships only by merging to `main` and pressing Publish in the Base44 editor (the app is linked to
  this repository with 2-way sync; `base44 deploy` does not reach production on a linked app). CI stays the
  green gate before the merge; the smoke script gains an actor mode.
- Tick budget measurements at 30 / 60 Hz (ADR 0004 exit criteria) before `TICK_RATE` moves (D-006, D-003).
- Lobby and room registry (Phase 3) designed around the platform's 300 connection attempts per minute per actor.
- Custom domain on the Base44 app; external uptime monitor on the published site.
- Optional: C++/WASM simulation core if profiling justifies it (ADR 0001).

## Standing work
Weekly dependency PRs, monthly independent security review recorded in `docs/HARDENING_REVIEW.md`.
