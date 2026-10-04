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
# P4 report: menu and settings (SPEC 33, D-030)

Branch `feat/pro-menu` on `pro-integration`, built on top of `feat/pro-feel` (it needs bindings.js); the PR diff shrinks to P4 once #29 merges.

## Shipped
- `prefs.js` schema (38 fields), coercion, persistence, crosshair CSS variables, key labels, keyboard layout.
- `bindings.js` mouse pseudo codes, fire / ads / nextWeapon / prevWeapon actions, labels and groups, clearable Alt keys.
- `input.js` mouse buttons in the key set, wheel actions, ADS / crouch / sprint toggle and auto modes, invert Y, controller sensitivity, double tap preferences.
- `settingsPanel.js` tabbed modal, generated controls, keyboard map, mouse map, grouped table, capture with Esc / Backspace, conflicts, reset.
- `hud.applyPrefs` crosshair, HUD scale and opacity, toggles; `audio.setVolume`; `game.applyPrefs` and feel scaling.
- Removed the OFL Rajdhani fonts (CC0 only).

## Verification
- Lint (policy, AGENTS.md, eslint), unit 1039/1039, build green.
- Manual QA: open Settings, Keybinds tab: click Fire, press Mouse 5, the table and the mouse map update; bind Jump secondary to Wheel Down, the conflict badge appears; Reset restores. Controls: set ADS to toggle, right click once in game aims until the next click. HUD: change style to circle and color to cyan, the preview and the in game crosshair follow; HUD scale slides the status block. Video: quality low removes bloom and shadows live.

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
## Cross-batch notes
- P5 reads `hud.prefs` (minimap, hitMarkers, damageNumbers, colorblind). P6 reads `game.prefs` (footsteps, hitSound, uiVolume, autoReload).
