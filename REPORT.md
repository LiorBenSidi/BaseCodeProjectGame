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
- `npm run lint`, `npm run test:unit` (1033 tests), `npm run build` green on this clone; fresh clone verification before the PR.
- Manual QA: sprint sideways and backwards (faster than walk), tap C while sprinting backwards (backward slide), double tap Shift (fov kick, faster for 2.5 s, 4 s before it works again), V while sprinting (dive, low camera), slide then jump within 0.25 s (keeps speed), land from a ledge (camera dip), right mouse with the sniper (slower zoom and sensitivity than the SMG), plug a gamepad (sticks move and aim, RT fires, LT aims, X reloads, Y switches, LB / RB abilities).

## Not done
- No persisted keybind UI (P4). No sample audio for the new states (P6). The snapshot does not carry tac or dive timers (client local like the slide).
