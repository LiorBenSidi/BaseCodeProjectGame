# Batch D1 notes (moved into the PR body by the coordinator, then deleted)

## Done (chunk 1: 19.2 and 19.4)
- Pure modules with tests: deviceMode.js, hudModel.js, theme.js, settings.js (866 unit tests green, from 846 on main).
- Touch gating: touch.js resolves the device mode through deviceMode.js; controls show only in touch mode, the
  landscape hint only in touch mode, enable() is a no-op on desktop, updateMode() re-applies after an override change.
- Settings panel on the menu (gear button): mouse sensitivity (live), Touch controls Auto / On / Off (live, also
  mid-match), Show FPS (bottom-left readout). Persisted under bca.sensitivity, bca.touchControls, bca.showFps.
- Theme: theme.js tokens injected as CSS variables at startup; style.css menu restyled as a dark launcher card
  using the variables (system font stack, one accent). Headless Chrome check on the built page: theme-vars style
  present, slider shows 2.2, #touch and #fps hidden on a desktop UA.

## Not finished
- 19.1 in-match HUD rendering (hudModel.js exists, the DOM and CSS wiring does not).
- 19.3 arena visual pass (scene.js, remote.js untouched).

## Decisions for Lior
- Sensitivity is displayed as rad per 1000 px (2.2 by default) so the slider reads as a plain number.
- Team color = player id parity (blue even, red odd) until a real team field exists in the snapshot (SPEC 19.1, 19.3).
- The touch buttons keep their existing glyph labels; a later chunk can swap them for inline SVG.

## How to verify in the browser (chunk 1)
1. Desktop: open the site, the menu is a centered dark card with a gear button; no touch controls, no rotate hint.
2. Gear: slider moves and the number updates; reload, the value persists. Show FPS: a counter appears bottom-left.
3. Touch controls = On on a desktop: press Play, the on-screen stick and buttons appear; switch to Off mid-match
   (Esc, gear), they disappear. Auto on a phone or iPad: controls appear without touching the setting.
