import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SENSITIVITY,
  KEYS,
  clampSensitivity,
  getSensitivity,
  getShowFps,
  getTouchControls,
  setSensitivity,
  setShowFps,
  setTouchControls,
} from '../../src/client/settings.js';

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
}

test('clampSensitivity: clamps values to range [0.0005, 0.01]', () => {
  assert.equal(clampSensitivity(0.0022), 0.0022);
  assert.equal(clampSensitivity(0.0001), 0.0005);
  assert.equal(clampSensitivity(0.05), 0.01);
  assert.equal(clampSensitivity('0.005'), 0.005);
  assert.equal(clampSensitivity('invalid'), DEFAULT_SENSITIVITY);
  assert.equal(clampSensitivity(NaN), DEFAULT_SENSITIVITY);
  assert.equal(clampSensitivity(Infinity), DEFAULT_SENSITIVITY);
});

test('getSensitivity & setSensitivity: storage interaction', () => {
  const storage = createMockStorage();

  assert.equal(getSensitivity(storage), DEFAULT_SENSITIVITY);

  setSensitivity(storage, 0.005);
  assert.equal(storage.getItem(KEYS.SENSITIVITY), '0.005');
  assert.equal(getSensitivity(storage), 0.005);

  setSensitivity(storage, 0.999);
  assert.equal(getSensitivity(storage), 0.01);

  setSensitivity(storage, 'bad');
  assert.equal(getSensitivity(storage), DEFAULT_SENSITIVITY);
});

test('getTouchControls & setTouchControls: delegated storage handling', () => {
  const storage = createMockStorage();

  assert.equal(getTouchControls(storage), 'auto');

  setTouchControls(storage, 'on');
  assert.equal(storage.getItem(KEYS.TOUCH_CONTROLS), 'on');
  assert.equal(getTouchControls(storage), 'on');

  setTouchControls(storage, 'off');
  assert.equal(getTouchControls(storage), 'off');

  setTouchControls(storage, 'unknown');
  assert.equal(getTouchControls(storage), 'auto');
});

test('getShowFps & setShowFps: boolean toggle persistence', () => {
  const storage = createMockStorage();

  assert.equal(getShowFps(storage), false);

  setShowFps(storage, true);
  assert.equal(storage.getItem(KEYS.SHOW_FPS), 'true');
  assert.equal(getShowFps(storage), true);

  setShowFps(storage, false);
  assert.equal(storage.getItem(KEYS.SHOW_FPS), 'false');
  assert.equal(getShowFps(storage), false);
});
