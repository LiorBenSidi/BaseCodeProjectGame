# P1 report: environment and graphics (SPEC 30, D-027)

Branch `feat/pro-env` on `pro-integration`. Implemented directly (the worker left only the docs commit).

## Shipped
- `themes.js` three map themes (sky, fog, sun, hemi, fill, exposure, surfaces, accent), quality tiers and auto detection.
- `textures.js` procedural tiling PBR surfaces (albedo + roughness, five recipes), world sized repeat, DOM free fallback.
- `scene.js` rebuilt: themed sky dome with sun disc, per theme lights, textured floor and boxes (walls vs cover), props, disposal on map change, `render()` through the post pipeline, `setQuality`.
- `post.js` EffectComposer (bloom, FXAA, output); `low` renders directly.
- `shared/props.js` + `client/props.js` deterministic props from the collision boxes; no floor props, no collision needed.
- `combatFx.js` pooled muzzle flashes, impact sparks, explosion light, wired to `shot` / `boom`.
- `pickups.js` readable 3D pickup models. `settings.js` quality persistence. `game.js` edits inside `// PRO-env`.
- Docs: SPEC 30 rewritten to what shipped, ASSETS.md (no external assets), D-027 amendment.

## Verification
- `npm run lint`, unit 1023/1023, `npm run build` (864 kB minified, 231 kB gzip; the chunk warning is three.js itself).
- Manual QA: load each map (match rotation) and check: themed sky and fog, textured walls with no stretching on the tall perimeter, crates on the decks and pillars, lamps on the walls, sparks at bullet impacts, orange flash on a grenade. Toggle `localStorage.setItem('bca.quality','low')` and reload: no bloom, no shadows, same gameplay.

## Cross-batch notes
- `game.js`: `renderer.render` replaced by `this.#gfx.render()`; P3's camera code is untouched and merges cleanly around it.
- P4 adds the quality selector (`Game.setQuality`, `settings.getQuality`).
- `arenaStyle.js` SKY / FOG / SUN / HEMI / FILL / FLOOR remain exported for SPEC 19.3 tests but the scene now reads the themes.
# P3 report: BO6 feel (SPEC 32, D-029)

Branch `feat/pro-feel` on `pro-integration`. Implemented directly after two worker stalls; the worker's uncommitted draft was reviewed, a spread math regression it introduced was reverted, its bindings table was corrected to the shipped controls.

## Shipped
- Shared: tuning table, omnidirectional sprint and slide, tactical sprint (burst and cooldown), dive, slide cancel, `mantled` flag. `protocol.js` whitelists `dive` and `tac`. Actor mirror synced.
- Client: `bindings.js` (default map, setters, conflicts, `isBound`), `input.js` (bindings, double taps, full gamepad mapping with edge actions, `aimTurn` for assisted devices), `aim.js` (`adsSensitivity`, `adsLerpRate`, `stepFovFor`), `cameraFeel.js`, `aimAssist.js`, `eventBus.js`, `game.js` wiring inside `// PRO-feel` blocks, `touch.js` aim through `aimTurn`, `remote.js` `latest()`.
- Docs: SPEC 32 (+ amendment note on 23.2), D-029.

## Cross-batch edits
- `src/client/remote.js`: `latest()` added (P2 owns the file; additive).
- `src/client/game.js`: PRO-feel blocks only.
- `src/shared/weapons.js`: `adsMs`, `adsSensMul`, `RECOIL_RECOVERY_MS`.
- Expected by other batches: P4 settings editor uses `bindings.js`; P5 and P6 subscribe to `eventBus` events `bodyHit`, `headshot`, `killConfirm`, `kill`; P2 may implement `WeaponView.inspect()` (called optionally on F).

## Verification
- `npm run lint`, `npm run test:unit` (1032 tests), `npm run build` green on this clone; fresh clone verification before the PR.
- Manual QA: sprint sideways and backwards (faster than walk), tap C while sprinting backwards (backward slide), double tap Shift (fov kick, faster for 2.5 s, 4 s before it works again), V while sprinting (dive, low camera), slide then jump within 0.25 s (keeps speed), land from a ledge (camera dip), right mouse with the sniper (slower zoom and sensitivity than the SMG), plug a gamepad (sticks move and aim, RT fires, LT aims, X reloads, Y switches, LB / RB abilities).

## Not done
- No persisted keybind UI (P4). No sample audio for the new states (P6). The snapshot does not carry tac or dive timers (client local like the slide).
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
