// Player preferences (SPEC 33, D-030). Pure schema plus persistence. One JSON object under `bca.prefs`; every value is
// validated against the schema on load, so a corrupt or hostile store falls back field by field to the default.
// The legacy keys from settings.js (sensitivity, fov, fps, sound, touch, quality) stay the source for those five
// values so earlier players keep what they chose; prefs.js adds everything a modern FPS exposes.

export const PREFS_KEY = 'bca.prefs';

// type: 'range' { min, max, step }, 'bool', 'enum' { values }, 'color' (one of CROSSHAIR_COLORS keys)
export const CROSSHAIR_COLORS = Object.freeze({ green: '#3ddc84', cyan: '#5ce1ff', white: '#f2f5f8', yellow: '#ffd23f', magenta: '#ff5ce1', red: '#ff5252' });

export const PREFS_SCHEMA = Object.freeze({
  // Controls
  adsSensMul: { tab: 'controls', label: 'ADS sensitivity multiplier', type: 'range', min: 0.3, max: 2, step: 0.05, def: 1 },
  invertY: { tab: 'controls', label: 'Invert vertical look', type: 'bool', def: false },
  adsMode: { tab: 'controls', label: 'Aim down sights', type: 'enum', values: ['hold', 'toggle'], def: 'hold' },
  crouchMode: { tab: 'controls', label: 'Crouch', type: 'enum', values: ['hold', 'toggle'], def: 'hold' },
  sprintMode: { tab: 'controls', label: 'Sprint', type: 'enum', values: ['hold', 'toggle', 'auto'], def: 'hold' },
  tacSprintDoubleTap: { tab: 'controls', label: 'Double tap sprint for tactical sprint', type: 'bool', def: true },
  diveDoubleTap: { tab: 'controls', label: 'Double tap crouch to dive', type: 'bool', def: true },
  autoReload: { tab: 'controls', label: 'Reload automatically when empty', type: 'bool', def: true },
  gamepadSens: { tab: 'controls', label: 'Controller look sensitivity', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1 },
  gamepadDeadzone: { tab: 'controls', label: 'Controller inner deadzone', type: 'range', min: 0.05, max: 0.4, step: 0.01, def: 0.15 },
  gamepadOuterDeadzone: { tab: 'controls', label: 'Controller outer deadzone', type: 'range', min: 0, max: 0.3, step: 0.01, def: 0.02 }, // SPEC 36.3
  gamepadCurve: { tab: 'controls', label: 'Controller response curve', type: 'enum', values: ['standard', 'linear', 'dynamic'], def: 'standard' }, // SPEC 36.3
  aimAssist: { tab: 'controls', label: 'Aim assist (controller and touch only)', type: 'bool', def: true },
  // Video
  quality: { tab: 'video', label: 'Graphics quality', type: 'enum', values: ['auto', 'low', 'medium', 'high'], def: 'auto' },
  spatialAudio: { tab: 'audio', label: 'Spatial audio', type: 'enum', values: ['stereo', 'hrtf'], def: 'stereo' }, // SPEC 37.6
  enemyOutline: { tab: 'video', label: 'Enemy outline', type: 'enum', values: ['off', 'yellow', 'red', 'purple'], def: 'off' }, // SPEC 37.5
  renderScale: { tab: 'video', label: 'Render scale (%)', type: 'range', min: 50, max: 100, step: 5, def: 100 }, // SPEC 36.4
  fpsCap: { tab: 'video', label: 'Frame rate limit', type: 'enum', values: ['off', '30', '60', '120', '144'], def: 'off' }, // SPEC 36.4
  telemetry: { tab: 'video', label: 'Telemetry readout (fps, ping, jitter, loss)', type: 'bool', def: false }, // SPEC 36.1
  headBob: { tab: 'video', label: 'Head bob', type: 'range', min: 0, max: 1, step: 0.1, def: 1 },
  fovKick: { tab: 'video', label: 'Sprint FOV kick', type: 'bool', def: true },
  cameraShake: { tab: 'video', label: 'Camera shake (landing, slide tilt)', type: 'range', min: 0, max: 1, step: 0.1, def: 1 },
  damageFlash: { tab: 'video', label: 'Screen flash when hit', type: 'bool', def: true },
  weaponSway: { tab: 'video', label: 'Weapon sway', type: 'bool', def: true },
  // Audio
  masterVolume: { tab: 'audio', label: 'Master volume', type: 'range', min: 0, max: 100, step: 1, def: 80 },
  sfxVolume: { tab: 'audio', label: 'Effects', type: 'range', min: 0, max: 100, step: 1, def: 100 },
  uiVolume: { tab: 'audio', label: 'Interface', type: 'range', min: 0, max: 100, step: 1, def: 70 },
  audioMix: { tab: 'audio', label: 'Audio mix', type: 'enum', values: ['default', 'night', 'headphones'], def: 'default' }, // SPEC 36.2
  hitSound: { tab: 'audio', label: 'Hit marker sound', type: 'bool', def: true },
  footsteps: { tab: 'audio', label: 'Footsteps', type: 'bool', def: true },
  // HUD
  crosshairStyle: { tab: 'hud', label: 'Crosshair style', type: 'enum', values: ['cross', 'dot', 'circle', 'tee', 'cross-dot'], def: 'cross' },
  crosshairColor: { tab: 'hud', label: 'Crosshair color', type: 'enum', values: Object.keys(CROSSHAIR_COLORS), def: 'green' },
  crosshairSize: { tab: 'hud', label: 'Crosshair size', type: 'range', min: 4, max: 30, step: 1, def: 14 },
  crosshairGap: { tab: 'hud', label: 'Crosshair gap', type: 'range', min: 0, max: 12, step: 1, def: 4 },
  crosshairThickness: { tab: 'hud', label: 'Crosshair thickness', type: 'range', min: 1, max: 5, step: 1, def: 2 },
  crosshairOutline: { tab: 'hud', label: 'Crosshair outline', type: 'bool', def: true },
  crosshairDynamic: { tab: 'hud', label: 'Crosshair expands while moving and firing', type: 'bool', def: true },
  hitMarkers: { tab: 'hud', label: 'Hit markers', type: 'bool', def: true },
  damageNumbers: { tab: 'hud', label: 'Damage numbers', type: 'bool', def: true },
  killFeed: { tab: 'hud', label: 'Kill feed', type: 'bool', def: true },
  minimap: { tab: 'hud', label: 'Minimap', type: 'bool', def: true },
  minimapFootsteps: { tab: 'hud', label: 'Minimap footstep ring (while sprinting)', type: 'bool', def: true }, // SPEC 37.3
  minimapCone: { tab: 'hud', label: 'Minimap vision cone', type: 'bool', def: true }, // SPEC 37.3
  hudScale: { tab: 'hud', label: 'HUD scale', type: 'range', min: 0.7, max: 1.3, step: 0.05, def: 1 },
  hudOpacity: { tab: 'hud', label: 'HUD opacity', type: 'range', min: 0.4, max: 1, step: 0.05, def: 1 },
  colorblind: { tab: 'hud', label: 'Team colors', type: 'enum', values: ['default', 'deuteranopia', 'tritanopia'], def: 'default' },
});

export const PREF_KEYS = Object.freeze(Object.keys(PREFS_SCHEMA));
export const TABS = Object.freeze([
  { id: 'controls', label: 'Controls' }, { id: 'keybinds', label: 'Keybinds' }, { id: 'video', label: 'Video' }, { id: 'audio', label: 'Audio' }, { id: 'hud', label: 'HUD' },
]);

export function defaults() {
  return Object.fromEntries(PREF_KEYS.map((k) => [k, PREFS_SCHEMA[k].def]));
}

// Validates one value against its schema entry; returns the clamped value or the default.
export function coerce(key, value) {
  const s = PREFS_SCHEMA[key];
  if (!s) return undefined;
  if (s.type === 'bool') return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : s.def;
  if (s.type === 'enum') return s.values.includes(value) ? value : s.def;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return s.def;
  const clamped = Math.min(s.max, Math.max(s.min, n));
  const steps = Math.round((clamped - s.min) / s.step);
  return Number((s.min + steps * s.step).toFixed(6));
}

export function sanitize(obj) {
  const out = defaults();
  if (!obj || typeof obj !== 'object') return out;
  for (const k of PREF_KEYS) if (Object.hasOwn(obj, k)) out[k] = coerce(k, obj[k]); // own keys only: a prototype trick cannot smuggle values
  return out;
}

export function loadPrefs(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch { return defaults(); }
}

export function savePrefs(prefs, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  const clean = sanitize(prefs);
  try { storage?.setItem(PREFS_KEY, JSON.stringify(clean)); } catch { /* storage unavailable: lasts for the session */ }
  return clean;
}

// Fields a tab shows, in schema order.
export function fieldsFor(tab) {
  return PREF_KEYS.filter((k) => PREFS_SCHEMA[k].tab === tab);
}

// SPEC 36.6 settings search (the CS2 / BO6 search bar): every word of the query must appear in the label, the key,
// the tab name or one of the enum values. Case insensitive; an empty query matches nothing (the tabs take over).
export function searchFields(query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return PREF_KEYS.filter((k) => {
    const s = PREFS_SCHEMA[k];
    const hay = [s.label, k, s.tab, ...(s.values ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// Crosshair CSS variables for #crosshair from the prefs (SPEC 33.4).
export function crosshairStyle(p) {
  const color = CROSSHAIR_COLORS[p.crosshairColor] ?? CROSSHAIR_COLORS.green;
  return {
    '--ch-color': color,
    '--ch-size': `${p.crosshairSize}px`,
    '--ch-gap': `${p.crosshairGap}px`,
    '--ch-thick': `${p.crosshairThickness}px`,
    '--ch-outline': p.crosshairOutline ? '0 0 0 1px rgba(0,0,0,0.85)' : 'none',
    '--ch-dot': p.crosshairStyle === 'dot' || p.crosshairStyle === 'cross-dot' ? 'block' : 'none',
    '--ch-lines': p.crosshairStyle === 'dot' || p.crosshairStyle === 'circle' ? 'none' : 'block',
    '--ch-top': p.crosshairStyle === 'tee' ? 'none' : 'block',
    '--ch-ring': p.crosshairStyle === 'circle' ? 'block' : 'none',
  };
}

// Human readable key names for the keybind table and the keyboard map (KeyboardEvent.code and mouse pseudo codes).
export function keyLabel(code) {
  if (!code) return 'Unbound';
  const table = {
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
    Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel Up', WheelDown: 'Wheel Down',
  };
  if (table[code]) return table[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export const isMouseCode = (code) => typeof code === 'string' && (/^Mouse[0-4]$/.test(code) || code === 'WheelUp' || code === 'WheelDown');

// Keyboard map layout for the visual keybind overview: rows of KeyboardEvent.codes with display widths.
export const KEYBOARD_ROWS = Object.freeze([
  ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'Backspace:2'],
  ['Tab:1.5', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash:1.5'],
  ['CapsLock:1.8', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter:2.2'],
  ['ShiftLeft:2.3', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'ShiftRight:2.7'],
  ['ControlLeft:1.5', 'AltLeft:1.3', 'Space:6.4', 'AltRight:1.3', 'ControlRight:1.5'],
]);
