import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickupText, PICKUP_STYLE } from '../../src/client/pickups.js';
import { PICKUP_TYPES } from '../../src/shared/rules.js';

test('every pickup type has a client style', () => {
  assert.deepEqual(Object.keys(PICKUP_STYLE).sort(), Object.keys(PICKUP_TYPES).sort());
});

test('pickupText is the HUD line for a pickup message', () => {
  assert.equal(pickupText({ kind: 'health', amount: 30 }), '+30 health');
  assert.equal(pickupText({ kind: 'ammo', amount: 12 }), '+12 ammo');
  assert.equal(pickupText({ kind: 'weapon', amount: 0, weapon: 'shotgun' }), 'Picked up Shotgun');
  assert.equal(pickupText({ kind: 'other' }), '');
});
