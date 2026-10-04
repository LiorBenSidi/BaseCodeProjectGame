# P6 report: sound engine, bots, practice range, onboarding (SPEC 35, D-032)

Branch `feat/pro-audio` on `pro-integration`.

## Shipped
- Audio: layered procedural engine with panning, distance lowpass, far gunfire variant, buses (master / sfx / ui), ducking, node cap, 14 new cues. Game sets the listener each frame and passes world positions for remote cues; jump / land / slide / reload / switch / headshot cues added.
- Bots: `src/shared/bots.js` brain (deterministic), `GameRoom` seat filling per mode (`BOT_CONFIG`), `[BOT]` scoreboard tag, `bot: 1` in snapshots, humans only in persistence, no bots in diag rooms. `BOT_FILL` env on the dev server. Actor host passes the mode config.
- Practice range mode with dummies, endless, lobby option.
- Tutorial card (10 action-driven steps) in the range; five one-time tips in live matches.

## Verification
- Lint, unit 1026/1026, build green. Dev server live check: a lone human gets bot "Rook", who moves and fires.
- Manual QA: pick Practice Range, Create room: the tutorial card walks the steps, dummies wander. Quick Play DM alone: a medium bot hunts you; a second human replaces it. Headphones: a shot to your right pans right, far shots sound dull and low.

## Cross-batch notes
- audio.js: P4 settings may call `setVolume`; this engine exposes `setLevel(bus, v)`. Wire P4's sliders to `setLevel('master' | 'sfx' | 'ui', v)` at integration.
- game.js: `#cue` signature unchanged; the footsteps block gained a PRO-audio block right after it (P3 and P5 also touch the frame). hud.js scoreboard row edited (P4 / P5 touch other parts of hud.js).
- modes.js: P5 reworked startMatch / matchSnapshot; the `range` mode and `-1 left` must survive the merge.
