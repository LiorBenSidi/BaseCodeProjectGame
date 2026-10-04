// SPEC 33 (D-030): preferences schema and persistence, mouse bindings, keybind editor helpers. Pure parts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREFS_SCHEMA, PREF_KEYS, TABS, defaults, coerce, sanitize, loadPrefs, savePrefs, fieldsFor, crosshairStyle, keyLabel, isMouseCode, KEYBOARD_ROWS, CROSSHAIR_COLORS, PREFS_KEY } from '../../src/client/prefs.js';
import { DEFAULT_BINDINGS, ACTION_LABELS, REBINDABLE, ACTION_GROUPS, bind, setBinding, resetBindings, loadBindings, conflicts, isBound, getAllBindings } from '../../src/client/bindings.js';
import { restoreBindings, BINDINGS_KEY } from '../../src/client/settingsPanel.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };

test('schema: every field has a tab, a label and a valid default; every tab except keybinds has fields', () => {
  for (const k of PREF_KEYS) {
    const s = PREFS_SCHEMA[k];
    assert.ok(TABS.some((t) => t.id === s.tab), `${k} tab ${s.tab}`);
    assert.ok(typeof s.label === 'string' && s.label.length > 2);
    assert.equal(coerce(k, s.def), s.def, `${k} default survives coercion`);
    if (s.type === 'range') assert.ok(s.min < s.max && s.step > 0 && s.def >= s.min && s.def <= s.max);
    if (s.type === 'enum') assert.ok(s.values.includes(s.def) && s.values.length >= 2);
  }
  for (const t of TABS) if (t.id !== 'keybinds') assert.ok(fieldsFor(t.id).length >= 4, `${t.id} has fields`);
  assert.equal(fieldsFor('keybinds').length, 0);
  assert.ok(PREF_KEYS.length >= 35, `rich customization (${PREF_KEYS.length} fields)`);
});

test('coerce clamps ranges to their step, rejects unknown enum values and non booleans, and sanitize fills every field', () => {
  assert.equal(coerce('masterVolume', 150), 100);
  assert.equal(coerce('masterVolume', -5), 0);
  assert.equal(coerce('masterVolume', '42'), 42);
  assert.equal(coerce('adsSensMul', 0.52), 0.5, 'snapped to the 0.05 step');
  assert.equal(coerce('adsSensMul', 'NaN'), 1);
  assert.equal(coerce('crosshairStyle', 'triangle'), 'cross');
  assert.equal(coerce('crosshairStyle', 'circle'), 'circle');
  assert.equal(coerce('invertY', 'true'), true);
  assert.equal(coerce('invertY', 'yes'), false);
  assert.equal(coerce('nope', 1), undefined);
  const s = sanitize({ masterVolume: 999, invertY: true, __proto__: { hudScale: 5 }, bogus: 1 });
  assert.equal(s.masterVolume, 100); assert.equal(s.invertY, true); assert.equal(s.hudScale, 1); assert.equal('bogus' in s, false);
  assert.deepEqual(sanitize(null), defaults());
});

test('prefs persist as one JSON object and corrupt storage falls back to defaults', () => {
  const st = memStorage();
  assert.deepEqual(loadPrefs(st), defaults());
  const saved = savePrefs({ ...defaults(), crosshairColor: 'cyan', hudScale: 1.2, masterVolume: 500 }, st);
  assert.equal(saved.masterVolume, 100);
  assert.equal(JSON.parse(st.getItem(PREFS_KEY)).crosshairColor, 'cyan');
  assert.equal(loadPrefs(st).hudScale, 1.2);
  st.setItem(PREFS_KEY, '{not json');
  assert.deepEqual(loadPrefs(st), defaults());
  st.setItem(PREFS_KEY, '[1,2,3]');
  assert.deepEqual(loadPrefs(st), defaults());
});

test('crosshair css: style and color map to variables, dot and ring only for their styles', () => {
  const d = crosshairStyle(defaults());
  assert.equal(d['--ch-color'], CROSSHAIR_COLORS.green);
  assert.equal(d['--ch-size'], '14px'); assert.equal(d['--ch-dot'], 'none'); assert.equal(d['--ch-lines'], 'block'); assert.equal(d['--ch-ring'], 'none');
  const dot = crosshairStyle({ ...defaults(), crosshairStyle: 'dot', crosshairColor: 'red', crosshairOutline: false });
  assert.equal(dot['--ch-dot'], 'block'); assert.equal(dot['--ch-lines'], 'none'); assert.equal(dot['--ch-outline'], 'none'); assert.equal(dot['--ch-color'], CROSSHAIR_COLORS.red);
  const ring = crosshairStyle({ ...defaults(), crosshairStyle: 'circle' });
  assert.equal(ring['--ch-ring'], 'block'); assert.equal(ring['--ch-lines'], 'none');
  const tee = crosshairStyle({ ...defaults(), crosshairStyle: 'tee' });
  assert.equal(tee['--ch-top'], 'none'); assert.equal(tee['--ch-lines'], 'block');
  assert.equal(crosshairStyle({ ...defaults(), crosshairColor: 'bogus' })['--ch-color'], CROSSHAIR_COLORS.green);
});

test('key labels: letters, digits, modifiers and mouse pseudo codes read like a game menu; the keyboard map covers every default key', () => {
  assert.equal(keyLabel('KeyW'), 'W'); assert.equal(keyLabel('Digit3'), '3'); assert.equal(keyLabel('ShiftLeft'), 'L Shift');
  assert.equal(keyLabel('Mouse0'), 'Left Mouse'); assert.equal(keyLabel('Mouse2'), 'Right Mouse'); assert.equal(keyLabel('WheelDown'), 'Wheel Down'); assert.equal(keyLabel('Mouse4'), 'Mouse 5');
  assert.equal(keyLabel(null), 'Unbound'); assert.equal(keyLabel('Numpad7'), 'Num 7'); assert.equal(keyLabel('F5'), 'F5');
  assert.ok(isMouseCode('Mouse3') && isMouseCode('WheelUp') && !isMouseCode('KeyW') && !isMouseCode('Mouse9'));
  const onMap = new Set(KEYBOARD_ROWS.flat().map((s) => s.split(':')[0]));
  for (const [action, code] of Object.entries(DEFAULT_BINDINGS)) if (!isMouseCode(code)) assert.ok(onMap.has(code), `${action} key ${code} is on the keyboard map`);
});

test('bindings: mouse actions are defaults, every rebindable action has a label and group, Alt keys can be set and cleared, conflicts are reported', () => {
  resetBindings();
  assert.equal(bind('fire'), 'Mouse0'); assert.equal(bind('ads'), 'Mouse2'); assert.equal(bind('nextWeapon'), 'WheelDown'); assert.equal(bind('prevWeapon'), 'WheelUp');
  for (const a of REBINDABLE) { assert.ok(ACTION_LABELS[a] && ACTION_GROUPS.includes(ACTION_LABELS[a][1]), a); assert.ok(bind(a), `${a} has a default`); }
  assert.ok(isBound('fire', 'Mouse0'));
  assert.equal(setBinding('fire', 'Mouse4'), true);
  assert.ok(isBound('fire', 'Mouse4') && !isBound('fire', 'Mouse0'));
  assert.equal(setBinding('fire', null), false, 'a primary key cannot be cleared');
  assert.equal(setBinding('jumpAlt', 'WheelDown'), true);
  assert.ok(isBound('jump', 'WheelDown'));
  assert.equal(conflicts().some((c) => c.code === 'WheelDown' && c.actions.includes('jump') && c.actions.includes('nextWeapon')), true);
  assert.equal(setBinding('jumpAlt', null), true);
  assert.equal(bind('jumpAlt'), null);
  assert.equal(setBinding('bogusAlt', 'KeyI'), false);
  assert.equal(setBinding('fwd', ''), false);
  resetBindings();
  assert.equal(bind('fire'), 'Mouse0');
  assert.deepEqual(getAllBindings(), { ...DEFAULT_BINDINGS });
});

test('bindings persistence: restoreBindings reads the editor store, ignores junk and resets on corrupt JSON', () => {
  const st = memStorage();
  st.setItem(BINDINGS_KEY, JSON.stringify({ fwd: 'ArrowUp', fire: 'KeyX', fwdAlt: 'KeyW', nonsense: 'KeyZ', back: 42 }));
  assert.equal(restoreBindings(st), 3);
  assert.equal(bind('fwd'), 'ArrowUp'); assert.ok(isBound('fwd', 'KeyW')); assert.equal(bind('fire'), 'KeyX'); assert.equal(bind('back'), 'KeyS');
  st.setItem(BINDINGS_KEY, '{{');
  assert.equal(restoreBindings(st), 0);
  assert.equal(bind('fwd'), 'KeyW');
  assert.equal(loadBindings(null), 0);
});
