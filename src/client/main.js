import { installDebugHarness } from './debugHarness.js';
import { Game } from './game.js';
import { loadKit, saveKit, renderKitPicker } from './kitUi.js';
import { bindSettingsPanel } from './settingsPanel.js';
import { injectTheme } from './theme.js';
import { isTouchDevice } from './touch.js';

injectTheme();
const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const nameInput = document.getElementById('name');
const game = new Game(canvas);
installDebugHarness(game);
bindSettingsPanel(document, game);

// SPEC 24.6: kit picker, remembered across sessions.
let kit = loadKit(window.localStorage);
renderKitPicker(document.getElementById('kit-picker'), kit, (id) => { kit = id; saveKit(window.localStorage, id); game.selectKit(id); });

menu.addEventListener('submit', (e) => {
  e.preventDefault();
  game.join(nameInput.value, kit);
  menu.hidden = true;
  // Both must run inside the user gesture.
  if (isTouchDevice()) game.enableTouch();
  else capturePointer();
  menu.querySelector('#settings').hidden = true;
});

// Re-capture the mouse after Esc.
canvas.addEventListener('click', () => {
  if (game.joined && !isTouchDevice() && document.pointerLockElement !== canvas) capturePointer();
});

// requestPointerLock() returns a promise in current browsers and rejects when the browser
// refuses (embedded previews, lock cancelled by Esc). The game stays usable, so swallow it.
function capturePointer() {
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
}
