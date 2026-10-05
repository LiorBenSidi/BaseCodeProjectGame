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
# P5 report: ceremony, medals, vote, kill cam, minimap (SPEC 34, D-031)

Branch `feat/pro-ceremony` on `pro-integration`. The earlier draft's modes.js and medals.js were reworked (intro only on restart, medal ids over the wire).

## Shipped
- Server: intro phase on restart with frozen movement and `matchLive`; medals judged in `#kill` and broadcast; `matchEnd` carries `medals` and `voteCandidates`; `vote` message on both dispatch paths (server.js and matchSession.js); the voted map loads once per match number. Actor mirror synced.
- Client: `ceremony.js` pure math; HUD intro countdown, podium end screen with MVP, my medals, vote buttons with share bars and keys 1 / 2, medal toasts, kill cam tag, minimap canvas; `remote.js` history and hide; `game.js` kill cam camera override and wiring.

## Verification
- Lint, unit 1025/1025, build green.
- Manual QA: two browsers, let a DM run out (or set MODES.dm.timeLimitMs low locally): podium with K/D, vote buttons update live when the other browser votes, "Next match in Ns", then the 5 s countdown with both players frozen, GO, and the voted map. Get killed: the camera shows the killer's last 2.5 s from their eyes with the KILLCAM tag, then respawn. Medal toasts appear on First Blood, Double Kill, Headshot. Minimap top right shows walls, the ally dot, and an enemy dot only when near or after they fire.

## Cross-batch notes
- game.js keydown listener gets one line at the top (vote keys); P3 rewrote the listener body with bindings, keep both.
- remote.js: P2 rewrote #create and the update loop, P3 added latest(); P5 adds history / lastPlayers / setHidden and the hidden check in `mesh.visible`. Merge by hand at integration.
- hud.js: P4 added applyPrefs and `prefs`; P5 reads `this.prefs?.minimap`.
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

# P8 report: weapons, hands and melee (SPEC 38, D-037)

Branch `feat/pro-p8-weapons-hands-melee` on `main`.

## Shipped
- Weapons: burst rifle (3 round burst state machine, follow-up rounds fired by the room), LMG, revolver; slot-aware pickups on every map with their own pickup styles and view model holds; three new shot cues.
- Hands: `animClips.js` pure clip set composed on procedural arms; draw on every switch timed to `switchMs`, reload moves the left hand, sprint carry, idle breathing; the kit blade appears on a swing.
- Third person: remote figures read `rel` and `ml` from the snapshot (reload hand, swing arm, blade, clash shake), primed by the `melee` broadcast.
- Melee: `src/shared/melee.js` state machine, cone test, knockback through the dash lane, the clash and riposte; `melee` message in both dispatchers; middle mouse default, side buttons share the edge channel.

## Verification
- Lint, unit 1090/1090, regression 7/7, build green; actor mirror synced.
- Manual QA: pick up the revolver on arena (north edge), fire: a long trigger interval and a heavy kick. Burst rifle on crossfire: one click, three rounds. Melee a bot with middle mouse: swing, knockback, `melee` kill in the feed. Two browsers: swing into each other at the same moment, the spark and the ring, the later swing moves first.

## Cross-batch notes
- SPEC numbering: P7 (feat/pro-p7-valorant) owns section 37 and D-036; this branch appends 38 and D-037 after 36 / D-032 and will be rebased onto P7 at integration (tail-of-file conflicts only).
- `GameRoom` snapshot entry gained `ml`; the contract test lists it. `input.js` edge lists gained `melee` and a mousedown edge loop for side buttons.
