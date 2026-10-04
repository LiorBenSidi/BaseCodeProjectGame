# P2 report: weapons and characters (SPEC 31, D-028)

Branch `feat/pro-weapons` on `pro-integration`. Implemented directly (the worker left nothing).

## Shipped
- `weaponModels.js` shared parts table and materials for the five weapons; `weaponView.js` builds from it, adds forearms and gloves, `inspect()` animation (P3 calls it on F).
- `characterRig.js` rig dimensions, walk cycle, phase, hit flash and death pose curves; `remote.js` builds the articulated figure, animates limbs from interpolated speed, follows pitch, holds the snapshot weapon, flashes on hits (`flash(id)`), tips over on death.
- `game.js`: one line in the verdict handler (`// PRO-weapons`).
- Docs: SPEC 31, D-028.

## Verification
- Lint, unit 1021/1021, build green.
- Manual QA: join with two browsers; the other player walks with swinging legs, sprint leans forward, jump tucks, crouch shortens steps, the gun in hand changes with weapon pickups, hits flash white, a kill tips the body over and it fades; F in first person turns the weapon over.

## Cross-batch notes
- `game.js` verdict handler is also edited by P3 (events) in the same line; resolve at integration by keeping both calls.
