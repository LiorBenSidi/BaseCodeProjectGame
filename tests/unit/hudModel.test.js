import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KillFeedQueue,
  calculateDamageAngle,
  deriveAmmoStatus,
  deriveHealthSegments,
  deriveRespawnText,
  deriveTeamColor,
  deriveMatchStatus,
  deriveMatchEndText,
  sortScoreboardPlayers,
  attributeDamage,
  pruneThreats,
  DAMAGE_ATTRIBUTION_MS,
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
  // yaw = PI/2 faces -X (aimDir in src/shared/hitscan.js gives [-1, 0, 0]), so an attacker at +X is behind.
  const player = { x: 0, z: 0 };
  const attacker = { x: 10, z: 0 };
  const yaw = Math.PI / 2; // facing -X
  const angle = calculateDamageAngle(player, yaw, attacker);
  assert.ok(Math.abs(Math.abs(angle) - Math.PI) < 1e-5, `expected ~PI rad, got ${angle}`);
  // ...and an attacker at -X is straight ahead.
  assert.ok(Math.abs(calculateDamageAngle(player, yaw, { x: -10, z: 0 })) < 1e-5);
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

test('deriveAmmoStatus: infinite readout without weapon fields (older server)', () => {
  const ammo = deriveAmmoStatus();
  assert.equal(ammo.text, 'INF');
  assert.equal(ammo.status, 'READY');
  assert.equal(ammo.weapon, 'Rifle');
});

test('deriveAmmoStatus: SPEC 20.4 fields drive weapon name, counts and status', () => {
  assert.deepEqual(deriveAmmoStatus({ w: 'rifle', m: 30, r: 90, rel: 0 }), { weapon: 'Rifle', text: '30 / 90', status: 'READY' });
  assert.equal(deriveAmmoStatus({ w: 'rifle', m: 6, r: 90, rel: 0 }).status, 'LOW');
  assert.equal(deriveAmmoStatus({ w: 'rifle', m: 7, r: 90, rel: 0 }).status, 'READY');
  assert.equal(deriveAmmoStatus({ w: 'pistol', m: 0, r: 12, rel: 0 }).status, 'EMPTY');
  assert.equal(deriveAmmoStatus({ w: 'pistol', m: 0, r: 0, rel: 0 }).status, 'DRY');
  assert.equal(deriveAmmoStatus({ w: 'shotgun', m: 3, r: 8, rel: 1 }).status, 'RELOADING');
  assert.equal(deriveAmmoStatus({ w: 'smg', m: 35, r: 105, rel: 0 }).weapon, 'SMG');
});

test('deriveTeamColor: identifies team parity (even = blue, odd = red)', () => {
  assert.equal(deriveTeamColor(2), 'even');
  assert.equal(deriveTeamColor(4), 'even');
  assert.equal(deriveTeamColor(1), 'odd');
  assert.equal(deriveTeamColor(3), 'odd');
});

test('sortScoreboardPlayers: sorts by kills desc, deaths asc, then id asc', () => {
  const players = [
    { id: 3, k: 5, d: 2 },
    { id: 1, k: 5, d: 1 },
    { id: 2, k: 8, d: 3 },
    { id: 4, k: 5, d: 2 },
  ];
  const sorted = sortScoreboardPlayers(players);
  assert.deepEqual(sorted, [
    { id: 2, k: 8, d: 3 },
    { id: 1, k: 5, d: 1 },
    { id: 3, k: 5, d: 2 },
    { id: 4, k: 5, d: 2 },
  ]);
});

test('calculateDamageAngle: turning left by PI/2 moves an attacker ahead to the right of the screen', () => {
  // +yaw turns left (src/shared/movement.js). Facing -X, the world -Z direction is on the right hand.
  const angle = calculateDamageAngle({ x: 0, z: 0 }, Math.PI / 2, { x: 0, z: -10 });
  assert.ok(Math.abs(angle - Math.PI / 2) < 1e-5, `expected ~PI/2 rad, got ${angle}`);
});

test('calculateDamageAngle: turning right by PI/2 moves an attacker ahead to the left of the screen', () => {
  const angle = calculateDamageAngle({ x: 0, z: 0 }, -Math.PI / 2, { x: 0, z: -10 });
  assert.ok(Math.abs(angle + Math.PI / 2) < 1e-5, `expected ~-PI/2 rad, got ${angle}`);
});

test('attributeDamage: newest threat inside the window wins, older or future ones are ignored', () => {
  const threats = [
    { x: 1, z: 1, at: 1000 },
    { x: 5, z: 5, at: 1200 },
    { x: 9, z: 9, at: 1100 },
    { x: 7, z: 7, at: 1400 }, // not yet happened at now = 1300
  ];
  assert.deepEqual(attributeDamage(threats, 1300), { x: 5, z: 5 });
  assert.equal(attributeDamage(threats, 1000 + DAMAGE_ATTRIBUTION_MS + 1 + 400), null);
  assert.equal(attributeDamage([], 1300), null);
});

test('attributeDamage: a threat exactly at the window edge still counts', () => {
  assert.deepEqual(attributeDamage([{ x: 2, z: 3, at: 1000 }], 1000 + DAMAGE_ATTRIBUTION_MS), { x: 2, z: 3 });
  assert.equal(attributeDamage([{ x: 2, z: 3, at: 1000 }], 1001 + DAMAGE_ATTRIBUTION_MS), null);
});

test('pruneThreats: drops entries older than the window and keeps the rest in order', () => {
  const threats = [{ x: 0, z: 0, at: 100 }, { x: 1, z: 1, at: 500 }, { x: 2, z: 2, at: 700 }];
  assert.deepEqual(pruneThreats(threats, 800), [{ x: 1, z: 1, at: 500 }, { x: 2, z: 2, at: 700 }]);
  assert.deepEqual(pruneThreats(threats, 800, 50), []);
});

test('deriveRespawnText: counts down from RESPAWN_MS and never goes negative', () => {
  assert.equal(deriveRespawnText(0, 1000, 1000).text, 'Respawning in 3.0s...');
  assert.equal(deriveRespawnText(0, 2500, 1000).text, 'Respawning in 1.5s...');
  assert.equal(deriveRespawnText(0, 9000, 1000).text, 'Respawning in 0.0s...');
  assert.equal(deriveRespawnText(1, 9000, 1000), null);
});

// SPEC 22
test('deriveTeamColor follows the server team when present', () => {
  assert.equal(deriveTeamColor(1, 0), 'even');
  assert.equal(deriveTeamColor(2, 1), 'odd');
  assert.equal(deriveTeamColor(2, -1), 'even');
});

test('deriveMatchStatus formats the timer and team scores; deriveMatchEndText names the winner', () => {
  assert.deepEqual(deriveMatchStatus({ mode: 'dm', phase: 'playing', left: 125, ts: null }), { timer: '2:05', teams: '', ending: false });
  assert.deepEqual(deriveMatchStatus({ mode: 'tdm', phase: 'ending', left: 0, ts: [3, 5] }), { timer: '', teams: 'Blue 3  Red 5', ending: true });
  assert.deepEqual(deriveMatchStatus(null), { timer: '', teams: '', ending: false });
  assert.equal(deriveMatchEndText({ winner: { type: 'player', id: 4, name: 'Zed' } }, 4), 'Victory');
  assert.equal(deriveMatchEndText({ winner: { type: 'player', id: 4, name: 'Zed' } }, 1), 'Zed wins');
  assert.equal(deriveMatchEndText({ winner: { type: 'team', team: 1, name: 'Red' } }, 1), 'Red team wins');
  assert.equal(deriveMatchEndText({ winner: { type: 'draw' } }, 1), 'Draw');
});
