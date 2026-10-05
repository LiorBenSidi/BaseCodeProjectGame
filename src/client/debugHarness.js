// Manual-test harness for browsers that refuse pointer lock (embedded previews). Only active with
// ?debug=1. It drives the same intents as the real controls (input yaw/pitch, shoot, throw); the server
// still decides every hit, so nothing here can fake a result. See docs/TESTING.md.

const STEP = Math.PI / 12; // 15 degrees

export function installDebugHarness(game) {
  if (!new URLSearchParams(window.location.search).has('debug')) return;

  const api = {
    aim: (yaw, pitch = 0) => game.aim(yaw, pitch),
    turn: (dYaw, dPitch = 0) => { const s = game.debugState(); game.aim(s.yaw + dYaw, s.pitch + dPitch); },
    fire: () => game.fire(),
    throwGrenade: () => game.throwGrenade(),
    useAbility: (slot) => game.useAbility(slot), // SPEC 24
    pickPerk: (i) => game.pickPerk(i), // SPEC 25
    selectKit: (id) => game.selectKit(id),
    cycleStation: () => game.cycleStation(), // SPEC 37.7
    state: () => game.debugState(),
  };
  window.__arenaDebug = api;

  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  const title = document.createElement('strong');
  title.textContent = 'Debug harness';
  panel.append(title);
  const buttons = [
    ['◀ 15°', () => api.turn(STEP)],
    ['15° ▶', () => api.turn(-STEP)],
    ['▲', () => api.turn(0, STEP / 3)],
    ['▼', () => api.turn(0, -STEP / 3)],
    ['Fire', () => api.fire()],
    ['Throw (G)', () => api.throwGrenade()],
  ];
  for (const [label, action] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); action(); });
    panel.append(b);
  }
  document.body.append(panel);
}
