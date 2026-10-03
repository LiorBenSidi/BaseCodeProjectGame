// SPEC §15.1–15.2 (D-010, D-011, D-014). Expected numbers are hand computed from the decision tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneAt, bandDamage, shotDamage, applyDamage, resolveShot } from '../../src/shared/combat.js';
import { ZONE_MULTIPLIERS, RIFLE, GRENADE } from '../../src/shared/combatData.js';
import { WEAPON } from '../../src/shared/constants.js';

const at = (x, y, z) => ({ x, y, z });
const target = (o = {}) => ({ x: 0, y: 0, z: 0, yaw: 0, ...o });
// Shooter 10 m in front of a target at the origin, looking straight along +Z at height h, lateral x.
const shoot = (h, x = 0, p = target(), boxes = []) => resolveShot([x, h, -10], [0, 0, 1], RIFLE, boxes, [{ id: 7, p }]);

// ------------------------------------------------------------------ data
test('zone multipliers are the D-010 table', () => {
  assert.deepEqual(ZONE_MULTIPLIERS, { head: 1.5, upperTorso: 1.1, lowerTorso: 1.0, arms: 0.95, legs: 0.9 });
});

test('rifle has three bands 25/22/18 below 20/40/120 m (D-014)', () => {
  assert.deepEqual(RIFLE.bands, [{ below: 20, damage: 25 }, { below: 40, damage: 22 }, { below: 120, damage: 18 }]);
  assert.equal(RIFLE.range, WEAPON.range);
  assert.equal(RIFLE.cooldownMs, WEAPON.cooldownMs);
  assert.equal(RIFLE.bands[0].damage, WEAPON.damage);
});

test('grenade data matches D-015', () => {
  assert.equal(GRENADE.fuseMs, 3000);
  assert.equal(GRENADE.speed, 16);
  assert.equal(GRENADE.gravity, 24);
  assert.equal(GRENADE.maxDamage, 100);
  assert.equal(GRENADE.blastRadius, 5);
  assert.equal(GRENADE.perLife, 1);
});

// ------------------------------------------------------------------ zones
test('zoneAt: every zone on a target facing -Z', () => {
  const p = target();
  assert.equal(zoneAt(p, at(0, 1.7, -0.4)), 'head');
  assert.equal(zoneAt(p, at(0, 1.3, -0.4)), 'upperTorso');
  assert.equal(zoneAt(p, at(0, 1.0, -0.4)), 'lowerTorso');
  assert.equal(zoneAt(p, at(0, 0.5, -0.4)), 'legs');
  assert.equal(zoneAt(p, at(0.35, 1.3, -0.4)), 'arms');
  assert.equal(zoneAt(p, at(-0.35, 1.0, -0.4)), 'arms');
});

test('zoneAt: height boundaries belong to the zone above', () => {
  const p = target();
  assert.equal(zoneAt(p, at(0, 1.5, -0.4)), 'head');
  assert.equal(zoneAt(p, at(0, 1.15, -0.4)), 'upperTorso');
  assert.equal(zoneAt(p, at(0, 0.9, -0.4)), 'lowerTorso');
  assert.equal(zoneAt(p, at(0, 0.8999, -0.4)), 'legs');
});

test('zoneAt: lateral offset of exactly 0.25 is torso, beyond is arms', () => {
  const p = target();
  assert.equal(zoneAt(p, at(0.25, 1.3, -0.4)), 'upperTorso');
  assert.equal(zoneAt(p, at(0.2501, 1.3, -0.4)), 'arms');
});

test('zoneAt: head and legs ignore the lateral offset', () => {
  const p = target();
  assert.equal(zoneAt(p, at(0.39, 1.7, -0.4)), 'head');
  assert.equal(zoneAt(p, at(0.39, 0.3, -0.4)), 'legs');
});

test('zoneAt: arms follow the target yaw, not the world axes', () => {
  const p = target({ yaw: Math.PI / 2 }); // faces -X; its right is -Z
  assert.equal(zoneAt(p, at(-0.4, 1.3, 0.35)), 'arms');
  assert.equal(zoneAt(p, at(-0.4, 1.3, 0)), 'upperTorso');
  assert.equal(zoneAt(p, at(0.35, 1.3, 0)), 'upperTorso', 'an x offset is depth at this yaw');
});

test('zoneAt: height is measured from the target feet', () => {
  const p = target({ y: 2 });
  assert.equal(zoneAt(p, at(0, 3.7, -0.4)), 'head');
  assert.equal(zoneAt(p, at(0, 2.5, -0.4)), 'legs');
});

// ------------------------------------------------------------------ bands
test('bandDamage at and around every boundary', () => {
  const cases = [[0, 25], [19.99, 25], [20, 22], [39.99, 22], [40, 18], [119.99, 18], [120, 0], [200, 0]];
  for (const [d, dmg] of cases) assert.equal(bandDamage(RIFLE, d), dmg, `at ${d} m`);
});

test('shotDamage = band x zone, hand computed', () => {
  const cases = [
    ['head', 5, 37.5], ['upperTorso', 5, 27.5], ['lowerTorso', 5, 25], ['arms', 5, 23.75], ['legs', 5, 22.5],
    ['head', 30, 33], ['upperTorso', 30, 24.2], ['lowerTorso', 30, 22], ['arms', 50, 17.1], ['legs', 50, 16.2],
    ['head', 120, 0],
  ];
  for (const [zone, d, dmg] of cases) assert.equal(shotDamage(RIFLE, zone, d), dmg, `${zone} at ${d} m`);
});

// ------------------------------------------------------------------ applyDamage
test('applyDamage removes hp and reports the applied amount', () => {
  const p = { hp: 100 };
  assert.deepEqual(applyDamage(p, 37.5), { applied: 37.5, killed: false });
  assert.equal(p.hp, 62.5);
});

test('applyDamage clamps at 0 and reports a kill once', () => {
  const p = { hp: 10 };
  assert.deepEqual(applyDamage(p, 37.5), { applied: 10, killed: true });
  assert.equal(p.hp, 0);
  assert.deepEqual(applyDamage(p, 37.5), { applied: 0, killed: false });
  assert.equal(p.hp, 0);
});

test('applyDamage ignores zero and negative amounts', () => {
  const p = { hp: 50 };
  assert.deepEqual(applyDamage(p, 0), { applied: 0, killed: false });
  assert.deepEqual(applyDamage(p, -20), { applied: 0, killed: false });
  assert.equal(p.hp, 50);
});

test('applyDamage keeps two-decimal hp after repeated fractional hits', () => {
  const p = { hp: 100 };
  applyDamage(p, 24.2);
  applyDamage(p, 24.2);
  applyDamage(p, 24.2);
  assert.equal(p.hp, 27.4);
});

// ------------------------------------------------------------------ resolveShot
test('resolveShot: a level head-height shot at 9.6 m is a 37.5 head hit', () => {
  const r = shoot(1.7);
  assert.equal(r.targetId, 7);
  assert.equal(r.zone, 'head');
  assert.equal(r.dist, 9.6);
  assert.equal(r.damage, 37.5);
});

test('resolveShot: each zone through the full pipeline', () => {
  assert.equal(shoot(1.3).zone, 'upperTorso');
  assert.equal(shoot(1.0).zone, 'lowerTorso');
  assert.equal(shoot(0.4).zone, 'legs');
  assert.equal(shoot(1.3, 0.35).zone, 'arms');
  assert.equal(shoot(0.4).damage, 22.5);
});

test('resolveShot: a miss has no target, no zone and no damage', () => {
  const r = shoot(1.3, 2);
  assert.deepEqual({ targetId: r.targetId, zone: r.zone, damage: r.damage }, { targetId: null, zone: null, damage: 0 });
  assert.equal(r.t, RIFLE.range);
});

test('resolveShot: a wall between shooter and target blocks the hit', () => {
  const wall = { min: [-2, 0, -5], max: [2, 3, -4] };
  const r = shoot(1.3, 0, target(), [wall]);
  assert.equal(r.targetId, null);
  assert.equal(r.damage, 0);
  assert.equal(r.t, 5);
});

test('resolveShot: the band follows the impact distance (29.6 m head = 33)', () => {
  const r = resolveShot([0, 1.6, -30], [0, 0, 1], RIFLE, [], [{ id: 1, p: target() }]);
  assert.equal(r.zone, 'head');
  assert.equal(r.dist, 29.6);
  assert.equal(r.damage, 33);
});

test('resolveShot: a target beyond the rifle range is not hit', () => {
  const r = resolveShot([0, 1.3, -130], [0, 0, 1], RIFLE, [], [{ id: 1, p: target() }]);
  assert.equal(r.targetId, null);
});

test('resolveShot is pure: equal poses and rays give equal results', () => {
  const run = () => resolveShot([3, 1.6, -12], [-0.2, -0.05, 0.9787], RIFLE, [], [{ id: 1, p: target({ yaw: 0.7 }) }]);
  assert.deepEqual(run(), run());
});
