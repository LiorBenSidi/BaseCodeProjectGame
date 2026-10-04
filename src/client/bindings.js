// Keyboard key bindings lookup table (SPEC 32).
// Pure module: default map + getters/setters for configurable keybinds.

export const DEFAULT_BINDINGS = Object.freeze({
  fwd: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'KeyC',
  crouchAlt: 'ControlLeft',
  dive: 'KeyV',
  tacSprint: 'ShiftLeft',
  reload: 'KeyR',
  switch: 'KeyQ',
  ability1: 'KeyE',
  ability2: 'KeyF',
});

const map = { ...DEFAULT_BINDINGS };

export function bind(action) {
  return map[action] ?? DEFAULT_BINDINGS[action] ?? null;
}

export function setBinding(action, code) {
  if (typeof action === 'string' && typeof code === 'string') {
    map[action] = code;
  }
}

export function resetBindings() {
  for (const k of Object.keys(map)) delete map[k];
  Object.assign(map, DEFAULT_BINDINGS);
}

export function getAllBindings() {
  return { ...map };
}
