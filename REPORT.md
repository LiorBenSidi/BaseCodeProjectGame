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

## Cross-batch notes
- P5 reads `hud.prefs` (minimap, hitMarkers, damageNumbers, colorblind). P6 reads `game.prefs` (footsteps, hitSound, uiVolume, autoReload).
