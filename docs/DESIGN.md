# Design decisions

The single record of **what the owner decided** about the game. The assistant fills this in during design
interviews (see `docs/DESIGN_QUESTIONS.md`); it never invents an entry. Code, specs and tests that depend on a
decision cite its ID.

## How this file works
1. A question from the bank is asked in Discuss mode. The owner answers.
2. The assistant records the answer below as a **decision** with a date, then confirms it back to the owner.
3. If the answer changes game rules, `docs/SPEC.md` is updated first, then tests, then code.
4. A decision is only changed by a new dated entry that supersedes the old one (nothing is silently edited).
5. A question the owner cannot answer yet is recorded as **parked**: a default, and a trigger for revisiting it. Parked items are not re-asked until the trigger fires.

## Status
| Area | Questions asked | Decided | Open |
|---|---|---|---|
| Vision and audience (V) | 0 | 0 | 12 |
| Story and setting (S) | 0 | 0 | 9 |
| Core gameplay (G) | 0 | 0 | 12 |
| Modes and rules (M) | 0 | 0 | 9 |
| Weapons and items (W) | 0 | 0 | 10 |
| Movement and feel (MV) | 0 | 0 | 6 |
| Maps (MP) | 0 | 0 | 7 |
| Art (A) | 0 | 0 | 7 |
| Audio (AU) | 0 | 0 | 5 |
| Interface (UI) | 0 | 0 | 8 |
| Controls and accessibility (C) | 0 | 0 | 4 |
| Multiplayer (N) | 0 | 0 | 10 |
| Social (SO) | 0 | 0 | 6 |
| Progression (P) | 0 | 0 | 6 |
| Economy (E) | 0 | 0 | 6 |
| Accounts and privacy (AC) | 0 | 0 | 6 |
| Platform and technology (T) | 0 | 0 | 9 |
| Quality (Q) | 0 | 0 | 7 |
| Legal (L) | 0 | 0 | 4 |
| Operations (O) | 0 | 0 | 5 |
| Roadmap (R) | 0 | 0 | 5 |

## Decision log
<!-- Newest first. Template:
### D-001 (G1) Time-to-kill
- Status: decided | parked (default + revisit trigger)
- Date: YYYY-MM-DD
- Decision: ...
- Why / options considered: ...
- Affects: docs/SPEC.md section, files, tests
- Supersedes: (none)
-->

### D-018 (T, N) Event-driven clock in the Match actor
- Status: decided
- Date: 2026-10-03
- Decision: The deployed actor does not depend on the platform's managed ticker. Wall time is sampled on every
  actor event and the simulation steps that are due run then (`MatchHost.advance()`, at most 3 per event, then
  time is dropped and the clock re-anchors). A platform schedule (`"clock"`, every 500 ms while a player is
  seated) wakes an otherwise idle room. The Node/ws server keeps its `setInterval` ticker.
- Why / options considered: on the first deploy (2026-10-03) `handleTick` never fired in production while
  connect, join, messages and storage all worked; timers inside the object were not observed to run. Waiting
  for a platform fix would have blocked every batch after the hotfix. Rejected: a 30 Hz alarm (two storage
  writes per tick per room, and alarm latency is not a 33 ms clock); client-driven ticks only (an idle room
  would never respawn anyone).
- Affects: docs/SPEC.md §17.3; `base44/actors/Match/entry.ts`, `base44/actors/Match/matchHost.js`;
  `tests/unit/matchHost.test.js`, `tests/unit/actorBundle.test.js`.
- Supersedes: the "managed ticker at `TICK_RATE`" wording of D-017 (the rate is unchanged, the driver is not).

### D-017 (T, E) Hosting: a Base44 app (site + Match actor), Node server kept for development
- Status: decided
- Date: 2026-10-03
- Decision: The game becomes a regular Base44 app in the owner's workspace. The Three.js client is built by
  Vite and served by Base44 hosting; the simulation runs in a Base44 **Match actor** (one Durable Object per
  room id, managed ticker at `TICK_RATE`), which wraps `GameRoom` through the new transport-agnostic
  `MatchSession`. The Node/ws server stays as the development and test transport; the Base Code imported
  project (`BaseCodeProjectGame`) stays as the repository workspace. Accounts, leaderboards and the RPG layer
  (D-004) will use the same app's entities and functions, with `conn.identity.userId` as the verified player
  identity.
- Source: Owner, 2026-10-03: transform the project into a Base44-hosted app, under the owner's workspace,
  carrying every decision made so far; after the builder confirmed Actors fit the authoritative-room model.
- Constraints read from the platform (actor runtime, 2026-10-03): JSON text frames only (the binary wire format
  of Phase 1 is replaced by delta snapshots), at most 3 catch-up ticks after a stall, room state is lost on a
  wake unless persisted, no minimum tick interval (60 and 120 Hz are a measurement, not a rule), a room is
  placed near its first joiner for life (region goes into the room id), inbound frames are capped only at
  Cloudflare's 32 MiB (the 4 KB rule is re-applied in `MatchSession`).
- Affects: docs/SPEC.md §17; docs/adr/0004; `base44/`, `src/server/matchSession.js`, `src/client/netActor.js`,
  `src/client/game.js`; ROADMAP phases 5 and 6; one new dependency `@base44/sdk` (owner approval recorded here).
- Implementation status: scaffolded 2026-10-03 on branch `base44-app`; first deploy pending the app creation.

### D-016 (UI6, C) Mobile: landscape only, touch layout, landscape HUD
- Status: decided
- Date: 2026-10-03
- Decision: On touch devices the game is landscape only. Portrait shows a "rotate your device" overlay; on Play
  the client asks for fullscreen and a landscape orientation lock where the browser allows it. Touch layout:
  left half is a floating move stick (origin where the thumb lands), right half drags to look; buttons for
  Fire (hold), Jump, Grenade and Scoreboard (hold) sit on the right. The HUD scales down on short landscape
  screens and respects the notch / safe-area insets.
- Source: Owner chose all three ("Force/lock landscape, Touch controls layout, HUD fit for landscape").
- Affects: docs/SPEC.md §16; `src/client/touchMath.js`, `src/client/touch.js`, `src/client/input.js`, CSS.
- Implementation status: implemented 2026-10-03.

### D-015 (W9, G2) Throwable tuning and blast rules
- Status: decided
- Date: 2026-09-30
- Decision: One frag grenade. G throws it; one per life, restored on respawn; no cooking (the fuse starts at
  launch). Fuse 3 s, launch speed 16 m/s along the aim direction, gravity 24 m/s², bounce restitution 0.45.
  Blast damage 100 at the centre, falling linearly to 0 at 5 m. Self-damage is on; a self-kill counts a death
  but awards no kill. Solid map cover between the blast and a player blocks the damage.
- Source: Owner approved the proposed throwable tuning (2026-09-30) and chose "self-damage, cover blocks" when
  the combat work was rebuilt.
- Affects: docs/SPEC.md §15; `src/shared/combatData.js`, `src/shared/projectile.js`, GameRoom, client HUD.
- Supersedes: the open tuning list in D-012.
- Implementation status: implemented 2026-09-30.

### D-014 (W7) Rifle distance bands
- Status: decided
- Date: 2026-09-30
- Decision: Rifle base damage 25 below 20 m, 22 from 20 m to below 40 m, 18 from 40 m to below 120 m (the
  maximum range). The distance is shooter eye to impact point.
- Source: Owner approved "baseline close damage" (keep 25 up close) with the proposed tuning.
- Affects: docs/SPEC.md §15; `src/shared/combatData.js`.
- Supersedes: the open tuning in D-011.
- Implementation status: implemented 2026-09-30.

### D-013 (G10, Q4) Combat slice acceptance
- Status: decided
- Date: 2026-09-30
- Decision: Hit registration must be trustworthy, movement immediate, and the mechanic visible early. Verify the existing rifle before layering zones, bands and the throwable. Show server-confirmed body/head hitmarkers, damage or zone feedback, and a per-shot log containing the shot, resolved zone, applied damage and kill outcome.
- Source: Owner's approved Hit-Location Damage, Damage Profiles & Throwables PRD.
- Affects: docs/SPEC.md §15; future shared damage, GameRoom and client HUD tests.
- Implementation status: implemented 2026-09-30 (shots resolve against current positions; lag compensation is not built yet).

### D-012 (G2, W9) One throwable now; abilities later
- Status: decided
- Date: 2026-09-30
- Decision: Expand the one-rifle slice with one arcing, bouncing, fuse-detonated explosive throwable. Simulate it on the server; replicate its position/state in snapshots. Explosion damage falls off with distance and uses the same deterministic damage-application function as bullets. Abilities remain outside this slice.
- Source: Owner's clarification and approved PRD.
- Affects: docs/SPEC.md §15; future protocol, shared projectile, GameRoom and client work.
- Open tuning: fuse, throw speed, blast radius/damage curve, ammunition/replenishment, and self-damage/cover rules.
- Implementation status: implemented 2026-09-30 (shots resolve against current positions; lag compensation is not built yet).

### D-011 (W7) Per-weapon distance bands
- Status: decided
- Date: 2026-09-30
- Decision: Use three to four data-defined range bands per weapon. The first rifle starts with three bands, stepping down twice. Multiply the band base damage by the hit-zone multiplier.
- Source: Owner's clarification and approved PRD.
- Affects: docs/SPEC.md §15; future shared combat-profile data and boundary tests.
- Open tuning: rifle distance thresholds and base damage in each band.
- Implementation status: implemented 2026-09-30 (shots resolve against current positions; lag compensation is not built yet).

### D-010 (G1, W6) Five server-resolved damage zones
- Status: decided
- Date: 2026-09-30
- Decision: Head ×1.5, upper torso ×1.1, lower torso ×1.0, arms ×0.95, legs ×0.9. Store multipliers as tunable data. Resolve anatomical hit geometry server-side, never trust a client hit claim; use rewound geometry when lag compensation exists.
- Source: Owner selected five zones and approved the PRD's starting multipliers. These are this game's tuning values, not a universal COD table.
- Affects: docs/SPEC.md §15; future shared hit geometry/damage and GameRoom tests.
- Implementation status: implemented 2026-09-30 (shots resolve against current positions; lag compensation is not built yet).

### D-009 (T, C) Platforms and input
- Status: decided
- Date: 2026-09-30 (transcribed from the Tier 1 interview)
- Decision: Ship as a PWA and a desktop wrapper. Support keyboard/mouse, controllers and mobile touch.
- Affects: future client input and packaging work.

### D-008 (R) Milestones toward a public release
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: Work is milestone-driven, not deadline-driven; the final intent is a public release.
- Affects: docs/ROADMAP.md.

### D-007 (M) Mode order and queues
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: Modes arrive in the order tactical, arcade, battle royale. Tactical and arcade use separate queues.
- Affects: docs/ROADMAP.md; future lobby and matchmaking.

### D-006 (N) One simulation rate per room, per-player network rates
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: One authoritative simulation per room, 60 Hz by default. Each player's frame rate, input rate and
  snapshot rate are their own and do not change the room simulation.
- Affects: future tick scheduling (the running baseline still ticks at 30 Hz, see docs/SPEC.md §1).

### D-005 (V) Stand-out features
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: Prioritise unique, stand-out features over standard genre tropes.
- Affects: all future feature design.

### D-004 (V, P) RPG mechanics
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: RPG mechanics sit alongside traditional FPS gunplay. Specifics (progression, perks, classes) are
  still to be interviewed.
- Affects: future progression work.

### D-003 (T, N) Switchable tick rate
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: The core architecture must support switching the room tick rate between 30, 60 and 120 Hz.
- Affects: shared simulation (combat resolution is tick-rate independent, see docs/SPEC.md §15).
- Known cost: 120 Hz raises snapshot bandwidth and server CPU substantially; delta snapshots are a prerequisite.

### D-002 (V) Priority order
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: Netcode quality, then gameplay depth, launch speed, visuals, content amount, security.
- Affects: sequencing of every milestone.

### D-001 (V, R) Minimum lovable game
- Status: decided
- Date: 2026-09-30 (transcribed)
- Decision: A netcode-first slice: one arena, one weapon, free-for-all, to validate hit-registration feel.
  D-010–D-015 deliberately extend this slice with zones, bands and one throwable.
- Affects: docs/ROADMAP.md.

The question-coverage table above is the original interview checklist, not an implementation progress table.

## Open questions raised during work
_Anything the assistant discovered it needed to ask that is not in the bank yet. Add it to the bank too._
