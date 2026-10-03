import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, getTouchOverride, resolveDeviceMode, setTouchOverride } from '../../src/client/deviceMode.js';

test('resolveDeviceMode: override "on" always resolves to touch', () => {
  assert.equal(resolveDeviceMode({ override: 'on', hasTouch: false, coarsePointer: false, userAgentMobile: false }), 'touch');
});

test('resolveDeviceMode: override "off" always resolves to desktop', () => {
  assert.equal(resolveDeviceMode({ override: 'off', hasTouch: true, coarsePointer: true, userAgentMobile: true }), 'desktop');
});

test('resolveDeviceMode: auto requires hasTouch AND (coarsePointer OR userAgentMobile)', () => {
  assert.equal(resolveDeviceMode({ override: 'auto', hasTouch: true, coarsePointer: true, userAgentMobile: false }), 'touch');
  assert.equal(resolveDeviceMode({ override: 'auto', hasTouch: true, coarsePointer: false, userAgentMobile: true }), 'touch');
  assert.equal(resolveDeviceMode({ override: 'auto', hasTouch: true, coarsePointer: false, userAgentMobile: false }), 'desktop');
  assert.equal(resolveDeviceMode({ override: 'auto', hasTouch: false, coarsePointer: true, userAgentMobile: true }), 'desktop');
});

test('resolveDeviceMode: defaults to auto and desktop when options are empty', () => {
  assert.equal(resolveDeviceMode({}), 'desktop');
  assert.equal(resolveDeviceMode(), 'desktop');
});

test('getTouchOverride and setTouchOverride: read and persist to storage with fallback', () => {
  const store = {};
  const mockStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };

  assert.equal(getTouchOverride(mockStorage), 'auto');
  setTouchOverride(mockStorage, 'on');
  assert.equal(mockStorage.getItem(STORAGE_KEY), 'on');
  assert.equal(getTouchOverride(mockStorage), 'on');

  setTouchOverride(mockStorage, 'off');
  assert.equal(getTouchOverride(mockStorage), 'off');

  setTouchOverride(mockStorage, 'invalid_value');
  assert.equal(getTouchOverride(mockStorage), 'auto');
});
