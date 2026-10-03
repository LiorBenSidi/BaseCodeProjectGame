import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KillFeedQueue,
  calculateDamageAngle,
  deriveAmmoStatus,
  deriveHealthSegments,
  deriveRespawnText,
} from '../../src/client/hudModel.js';

test('calculateDamageAngle: direct front is 0 rads', () => {
  const player = { x: 0, z: 0 };
  const attacker = { x: 0, z: -10 };
  const yaw = 0; // facing -Z
  const angle = calculateDamageAngle(player, yaw, attacker);
  assert.ok(Math.abs(angle) < 1e-5, `expected ~0 rad, got ${angle}`);
});

test('calculateDamageAngle: direct right is PI/2 rads', () => {
  const player = { x: 0, z: 0 };
  const attacker = { x: 10, z: 0 };
  const yaw = 0; // facing -Z
  const angle = calculateDamageAngle(player, yaw, attacker);
  assert.ok(Math.abs(angle - Math.PI / 2) < 1e-5, `expected ~PI/2 rad, got ${angle}`);
});

test('calculateDamageAngle: direct behind is PI rads', () => {
  const player = { x: 0, z: 0 };
  const attacker = { x: 0, z: 10 };
  const yaw = 0; // facing -Z
  const angle = calculateDamageAngle(player, yaw, attacker);
  assert.ok(Math.abs(Math.abs(angle) - Math.PI) < 1e-5, `expected ~PI rad, got ${angle}`);
});

test('calculateDamageAngle: camera rotation rotates relative angle', () => {
  const player = { x: 0, z: 0 };
  const attacker = { x: 10, z: 0 };
  const yaw = Math.PI / 2; // facing +X
  const angle = calculateDamageAngle(player, yaw, attacker);
  assert.ok(Math.abs(angle) < 1e-5, `expected ~0 rad, got ${angle}`);
});

test('KillFeedQueue: caps at max 5 entries and expires after 5000 ms', () => {
  const queue = new KillFeedQueue(5, 5000);
  const now = 1000;

  for (let i = 1; i <= 6; i++) {
    queue.add(`Player ${i} eliminated target`, now);
  }

  let entries = queue.getEntries(now);
  assert.equal(entries.length, 5);
  assert.equal(entries[0].text, 'Player 2 eliminated target');
  assert.equal(entries[4].text, 'Player 6 eliminated target');

  // Fast forward past 5000 ms expiry from insertion time
  entries = queue.getEntries(now + 5001);
  assert.equal(entries.length, 0);
});

test('deriveHealthSegments: computes percent and 5 segment fill states', () => {
  const full = deriveHealthSegments(100, 100, 5);
  assert.equal(full.percent, 100);
  assert.deepEqual(full.segments, [1, 1, 1, 1, 1]);

  const half = deriveHealthSegments(50, 100, 5);
  assert.equal(half.percent, 50);
  assert.deepEqual(half.segments, [1, 1, 0.5, 0, 0]);

  const zero = deriveHealthSegments(0, 100, 5);
  assert.equal(zero.percent, 0);
  assert.deepEqual(zero.segments, [0, 0, 0, 0, 0]);
});

test('deriveRespawnText: displays countdown when dead, null when alive', () => {
  const now = 10000;
  const deathTime = 9000; // died 1s ago, 3s total respawn time -> 2.0s remaining

  const deadState = deriveRespawnText(0, now, deathTime, 3000);
  assert.ok(deadState.visible);
  assert.equal(deadState.text, 'Respawning in 2.0s...');

  const aliveState = deriveRespawnText(1, now, deathTime, 3000);
  assert.equal(aliveState, null);
});

test('deriveAmmoStatus: returns standard infinite weapon readout', () => {
  const ammo = deriveAmmoStatus();
  assert.equal(ammo.text, 'INF');
  assert.equal(ammo.status, 'READY');
});
