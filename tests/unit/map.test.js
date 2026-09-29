import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP } from '../../src/shared/map.js';
import { PLAYER } from '../../src/shared/constants.js';

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

test('MAP.half is a positive finite number', () => {
  assert.ok(isFiniteNum(MAP.half));
  assert.ok(MAP.half > 0);
});

test('MAP.boxes is an array', () => {
  assert.ok(Array.isArray(MAP.boxes));
});

test('every box has 3-element finite min and max vectors', () => {
  for (const [i, b] of MAP.boxes.entries()) {
    assert.ok(Array.isArray(b.min) && b.min.length === 3, `box ${i} min`);
    assert.ok(Array.isArray(b.max) && b.max.length === 3, `box ${i} max`);
    for (let a = 0; a < 3; a++) {
      assert.ok(isFiniteNum(b.min[a]), `box ${i} min[${a}] finite`);
      assert.ok(isFiniteNum(b.max[a]), `box ${i} max[${a}] finite`);
    }
  }
});

test('every box has min < max strictly on every axis', () => {
  for (const [i, b] of MAP.boxes.entries()) {
    for (let a = 0; a < 3; a++) {
      assert.ok(b.min[a] < b.max[a], `box ${i} axis ${a}: ${b.min[a]} < ${b.max[a]}`);
    }
  }
});

test('MAP.spawns is a non-empty array', () => {
  assert.ok(Array.isArray(MAP.spawns));
  assert.ok(MAP.spawns.length > 0);
});

test('every spawn has finite x, z and yaw', () => {
  for (const [i, s] of MAP.spawns.entries()) {
    assert.ok(isFiniteNum(s.x), `spawn ${i} x`);
    assert.ok(isFiniteNum(s.z), `spawn ${i} z`);
    assert.ok(isFiniteNum(s.yaw), `spawn ${i} yaw`);
  }
});

test('every spawn lies inside the [-half, half] play area on X and Z', () => {
  for (const [i, s] of MAP.spawns.entries()) {
    assert.ok(Math.abs(s.x) <= MAP.half, `spawn ${i} x=${s.x}`);
    assert.ok(Math.abs(s.z) <= MAP.half, `spawn ${i} z=${s.z}`);
  }
});

test('a player standing at y=0 on any spawn overlaps no box (touching allowed)', () => {
  for (const [i, s] of MAP.spawns.entries()) {
    const pmin = [s.x - PLAYER.radius, 0, s.z - PLAYER.radius];
    const pmax = [s.x + PLAYER.radius, PLAYER.height, s.z + PLAYER.radius];
    for (const [j, b] of MAP.boxes.entries()) {
      const overlaps = [0, 1, 2].every((a) => pmin[a] < b.max[a] && pmax[a] > b.min[a]);
      assert.equal(overlaps, false, `spawn ${i} overlaps box ${j}`);
    }
  }
});
