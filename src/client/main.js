import { installDebugHarness } from './debugHarness.js';
import { Game } from './game.js';
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

menu.addEventListener('submit', (e) => {
  e.preventDefault();
  game.join(nameInput.value);
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
