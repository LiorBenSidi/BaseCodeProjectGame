// SPEC §16.1 (D-016): pure touch-control math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STICK_RADIUS, lookDelta, needsRotate, stickVector } from '../../src/client/touchMath.js';

test('stickVector: thumb pushed up is full forward', () => {
  assert.deepEqual(stickVector(0, -60, 60), { fwd: 1, right: 0 });
});

test('stickVector: thumb pushed right is full strafe right', () => {
  assert.deepEqual(stickVector(60, 0, 60), { fwd: 0, right: 1 });
});

test('stickVector: half push gives half speed', () => {
  assert.deepEqual(stickVector(0, 30, 60), { fwd: -0.5, right: 0 });
});

test('stickVector: inside the deadzone is still', () => {
  const v = stickVector(5, 5, 60, 0.15);
  assert.equal(v.fwd === 0 && v.right === 0, true);
});

test('stickVector: past the rim is capped to length 1', () => {
  const v = stickVector(300, -400, 60);
  assert.ok(Math.abs(Math.hypot(v.fwd, v.right) - 1) < 1e-9);
  assert.ok(Math.abs(v.right - 0.6) < 1e-9);
  assert.ok(Math.abs(v.fwd - 0.8) < 1e-9);
});

test('stickVector: default radius is used when omitted', () => {
  assert.deepEqual(stickVector(STICK_RADIUS, 0), { fwd: 0, right: 1 });
});

test('lookDelta: drag right turns right (yaw decreases), drag up looks up', () => {
  assert.deepEqual(lookDelta(100, 0, 0.01), { yaw: -1, pitch: -0 });
  assert.deepEqual(lookDelta(0, -50, 0.01), { yaw: -0, pitch: 0.5 });
});

test('needsRotate: only touch devices held in portrait', () => {
  assert.equal(needsRotate(390, 844, true), true);
  assert.equal(needsRotate(844, 390, true), false);
  assert.equal(needsRotate(390, 844, false), false);
});
