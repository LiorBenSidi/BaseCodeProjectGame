import { installDebugHarness } from './debugHarness.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const nameInput = document.getElementById('name');
const game = new Game(canvas);
installDebugHarness(game);

menu.addEventListener('submit', (e) => {
  e.preventDefault();
  game.join(nameInput.value);
  menu.hidden = true;
  capturePointer(); // must run inside the user gesture
});

// Re-capture the mouse after Esc.
canvas.addEventListener('click', () => {
  if (game.joined && document.pointerLockElement !== canvas) capturePointer();
});

// requestPointerLock() returns a promise in current browsers and rejects when the browser
// refuses (embedded previews, lock cancelled by Esc). The game stays usable, so swallow it.
function capturePointer() {
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
}
