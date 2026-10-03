// SPEC §15.5 (D-013): client feedback derived only from server-shaped messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatLog, LOG_LIMIT, formatBoom, formatVerdict, markerKind } from '../../src/client/combatLog.js';

const names = new Map([[2, 'Ann'], [3, 'Bob']]);
const nameOf = (id) => names.get(id) ?? `#${id}`;
const verdict = (o) => ({ t: 'verdict', target: 2, zone: 'head', dmg: 37.5, dist: 3.6, kill: false, ...o });

test('markerKind: head hits and body hits are distinct; misses show nothing', () => {
  assert.equal(markerKind(verdict()), 'head');
  for (const zone of ['upperTorso', 'lowerTorso', 'arms', 'legs']) assert.equal(markerKind(verdict({ zone })), 'body');
  assert.equal(markerKind(verdict({ target: null, zone: null, dmg: 0 })), null);
});

test('formatVerdict: shot, zone, applied damage, distance', () => {
  assert.equal(formatVerdict(verdict(), nameOf), 'HIT Ann · head · 37.5 dmg · 3.6 m');
  assert.equal(formatVerdict(verdict({ zone: 'upperTorso', dmg: 24.2, dist: 30 }), nameOf), 'HIT Ann · upper torso · 24.2 dmg · 30 m');
});

test('formatVerdict: kills are marked', () => {
  assert.equal(formatVerdict(verdict({ dmg: 10, kill: true }), nameOf), 'HIT Ann · head · 10 dmg · 3.6 m · KILL');
});

test('formatVerdict: a miss says so and carries the distance', () => {
  assert.equal(formatVerdict(verdict({ target: null, zone: null, dmg: 0, dist: 70 }), nameOf), 'MISS · 70 m');
});

test('formatBoom: my grenade lists who it hit and the total', () => {
  const b = { t: 'boom', id: 1, owner: 1, at: [0, 0, 0], hits: [{ id: 2, dmg: 40, kill: false }, { id: 3, dmg: 100, kill: true }] };
  assert.equal(formatBoom(b, 1, nameOf), 'GRENADE · Ann 40, Bob 100 KILL');
});

test('formatBoom: hitting yourself is reported as self-damage', () => {
  const b = { t: 'boom', id: 1, owner: 1, at: [0, 0, 0], hits: [{ id: 1, dmg: 100, kill: true }] };
  assert.equal(formatBoom(b, 1, nameOf), 'GRENADE · self 100 KILL');
});

test('formatBoom: an empty blast from my grenade is reported; others with no effect on me are not', () => {
  assert.equal(formatBoom({ owner: 1, hits: [] }, 1, nameOf), 'GRENADE · no hits');
  assert.equal(formatBoom({ owner: 2, hits: [{ id: 3, dmg: 5, kill: false }] }, 1, nameOf), null);
});

test('formatBoom: someone else\'s grenade that hit me is reported', () => {
  assert.equal(formatBoom({ owner: 2, hits: [{ id: 1, dmg: 60, kill: false }] }, 1, nameOf), 'GRENADE from Ann · you took 60');
});

test('the log keeps at most LOG_LIMIT (8) entries, newest last', () => {
  const log = new CombatLog();
  assert.equal(LOG_LIMIT, 8);
  for (let i = 1; i <= 20; i++) log.push(`line ${i}`);
  assert.equal(log.entries.length, 8);
  assert.equal(log.entries[0], 'line 13');
  assert.equal(log.entries.at(-1), 'line 20');
});

test('the log ignores empty entries and returns a copy', () => {
  const log = new CombatLog();
  log.push(null);
  log.push('');
  log.push('a');
  const e = log.entries;
  e.push('mutated');
  assert.deepEqual(log.entries, ['a']);
});
