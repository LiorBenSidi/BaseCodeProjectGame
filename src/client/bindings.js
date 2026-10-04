// Key bindings (SPEC 32.6). Pure: a default action -> KeyboardEvent.code map, a `bind(action)` getter the input layer
// and game.js read every frame, and setters the settings UI uses. Persisted by the caller (settings.js) as a plain
// { action: code } object; unknown actions and non-string codes are ignored so a corrupt store cannot break input.
// Some actions accept a second key (`*Alt`) so Shift and Ctrl on either side keep working.

export const DEFAULT_BINDINGS = Object.freeze({
  fwd: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  sprintAlt: 'ShiftRight',
  crouch: 'KeyC',
  crouchAlt: 'ControlLeft',
  dive: 'KeyV',
  reload: 'KeyR',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  grenade: 'KeyG',
  ability1: 'KeyQ',
  ability2: 'KeyE',
  perk1: 'Digit3',
  perk2: 'Digit4',
  inspect: 'KeyF',
  scoreboard: 'Tab',
  chat: 'Enter',
});

export const ACTIONS = Object.freeze(Object.keys(DEFAULT_BINDINGS));

const map = { ...DEFAULT_BINDINGS };

export function bind(action) {
  return map[action] ?? null;
}

export function setBinding(action, code) {
  if (!ACTIONS.includes(action) || typeof code !== 'string' || code.length === 0 || code.length > 32) return false;
  map[action] = code;
  return true;
}

export function resetBindings() {
  Object.assign(map, DEFAULT_BINDINGS);
}

export function getAllBindings() {
  return { ...map };
}

// Loads a persisted { action: code } object; returns how many bindings were applied.
export function loadBindings(obj) {
  resetBindings();
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const [action, code] of Object.entries(obj)) if (setBinding(action, code)) n += 1;
  return n;
}

// Actions sharing a key, so the editor can warn. Alt keys of the same action are not conflicts; Tab and Enter can
// collide with nothing because they never move the player.
export function conflicts(bindings = map) {
  const byCode = new Map();
  for (const [action, code] of Object.entries(bindings)) {
    const base = action.replace(/Alt$/, '');
    const list = byCode.get(code) ?? [];
    if (!list.includes(base)) list.push(base);
    byCode.set(code, list);
  }
  return [...byCode.entries()].filter(([, actions]) => actions.length > 1).map(([code, actions]) => ({ code, actions }));
}

// True when `code` is one of the keys bound to `action` (its main key or its Alt key).
export function isBound(action, code) {
  return map[action] === code || map[`${action}Alt`] === code;
}
