# Asset Catalog

No external assets are shipped. Every texture, sky, prop and pickup model is generated procedurally at load
(SPEC 30, D-027): `src/client/textures.js` (surface tiles), `src/client/scene.js` (sky dome), `src/shared/props.js`
and `src/client/props.js` (props), `src/client/pickups.js` (pickup models). Audio cues are synthesized in
`src/client/audio.js` (SPEC 28.3).

When a downloaded asset is ever added, it must be CC0 (owner's rule, 2026-10-04) and appear here:

| File Path | Source URL | Author | License | Date Added |
| --- | --- | --- | --- | --- |
