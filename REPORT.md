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
