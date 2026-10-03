# Batch 2 notes (moved into the PR body by the coordinator, then deleted)

## Done
- 18.1 ClockSource: `base44/actors/Match/clockSource.js`, wired into `MatchHost` (`clock` option, stamp recorded
  before the session, connection removed on close, `clock` block in the diag frame) and `entry.ts` (ioWall sample
  after an awaited `storage.get("clock-io")` per message while seated, setTimeout evidence chain, `ACTOR_BUILD = "2.0"`).
- `input.ts` client stamp: `src/server/protocol.js` validation, `src/client/game.js` sends `Date.now()`.
- Actor copies regenerated with `node base44/tools/sync-actor.mjs` (actorBundle test green).
- Docs: SPEC 18.1, LIVE_TESTING probe paragraph.

## Not started
- 18.2 clock sync (ping/pong), 18.3 delta snapshots, 18.4 reconnect tokens, 18.5 blended reconciliation,
  18.6 lag compensation rewind. Each one is its own small PR after 18.1 proves a moving clock live.

## Decisions for Lior
- Client clock is delta based (anchored per connection at its first stamp), not absolute: an absolute stamp
  clamped against a frozen server clock would move once by the tolerance and freeze again.
- Speed bound: at most 100 ms of advance per stamped message, and at most 250 ms lead over the server clock
  once the server clock has been seen moving. While it never moves, the client clock is not clamped.
- `storage.get` on a never-written key per message while seated: one awaited I/O to try to unfreeze Date.now().
  If the live probe shows `advances.ioWall` at 0, the read is removed in the next batch.
- Timer evidence stops after 600 fires per object lifetime so a long-lived room does not keep a timer chain alive.
- `scripts/actor-probe.mjs` was NOT changed (protected path): its inputs carry no `ts`, so a Node probe cannot
  exercise `clientClock`; a browser player can. One-line change if you approve it: add `ts: Date.now()` to the
  input message on line 77.

## How to verify live (after merge, Publish and the approved actor deploy)
1. `npm run actor-probe -- 6ac103381bbc9fd85fefcb78 diag-live-4 12 --inputs --diag`
   expect `build: "2.0"`, a `clock` block, and compare the two frames: `advances.ioWall` growing means awaited I/O
   unfreezes the clock; `advances.timerTick` growing means timers fire; `snaps` well above 1 if either moves.
2. Open the site with `?room=diag-live-4`, press Play, move for 10 s, then run the probe again with `--diag`:
   `clock.source` should read `clientClock` and `stepsSinceAnchor` should be in the hundreds.
