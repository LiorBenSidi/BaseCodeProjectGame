// SPEC §15.3 (D-012, D-015). Hand-computed flight values use 1/120 s sub-steps and semi-implicit Euler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchGrenade, stepGrenade, blastDamage } from '../../src/shared/projectile.js';
import { GRENADE } from '../../src/shared/combatData.js';
import { MAP } from '../../src/shared/map.js';

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const OPEN = 1000; // bounds far away
const fresh = (dir = [0, 0, -1], origin = [0, 1.6, 0]) => launchGrenade(1, 9, origin, dir);
const overlaps = (g, b) => {
  const r = GRENADE.radius;
  return g.x - r < b.max[0] && g.x + r > b.min[0] && g.y - r < b.max[1] && g.y + r > b.min[1] && g.z - r < b.max[2] && g.z + r > b.min[2];
};

// ------------------------------------------------------------------ launch
test('launch: velocity is aim x 16 m/s and the fuse is 360 sub-steps', () => {
  const g = fresh([0.6, 0, -0.8]);
  assert.deepEqual({ id: g.id, owner: g.owner, x: g.x, y: g.y, z: g.z }, { id: 1, owner: 9, x: 0, y: 1.6, z: 0 });
  near(g.vx, 9.6);
  near(g.vz, -12.8);
  assert.equal(g.vy, 0);
  assert.equal(g.stepsLeft, 360);
  assert.equal(g.exploded, false);
});

// ------------------------------------------------------------------ flight
test('flight: one 30 Hz tick is 4 sub-steps of gravity', () => {
  const g = stepGrenade(fresh(), 1 / 30, [], OPEN);
  near(g.vy, -0.8, 1e-12);
  near(g.y, 1.6 - (1 / 120) * 0.2 * 10, 1e-12); // vy after each sub-step: -0.2, -0.4, -0.6, -0.8
  near(g.z, -16 * 4 / 120, 1e-12);
  assert.equal(g.stepsLeft, 356);
});

test('flight is identical at 30, 60 and 120 Hz for the same elapsed time', () => {
  const run = (hz) => {
    const g = fresh([0.3, 0.5, -0.8124]);
    for (let i = 0; i < hz / 2; i++) stepGrenade(g, 1 / hz, MAP.boxes, MAP.half);
    return g;
  };
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});

test('flight arcs: thrown up it rises, then falls', () => {
  const g = fresh([0, 0.6, -0.8]);
  stepGrenade(g, 0.25, [], OPEN);
  assert.ok(g.y > 1.6, 'rose');
  const top = g.y;
  stepGrenade(g, 0.5, [], OPEN);
  assert.ok(g.y < top, 'falls after the apex');
});

// ------------------------------------------------------------------ collision
test('floor: a grenade thrown down bounces up and never sinks below its radius', () => {
  const g = fresh([0, -1, 0], [0, 1, 0]);
  let bounced = false;
  for (let i = 0; i < 60; i++) {
    stepGrenade(g, 1 / 120, [], OPEN);
    assert.ok(g.y >= GRENADE.radius - 1e-12);
    if (g.vy > 0) bounced = true;
  }
  assert.ok(bounced);
});

test('floor: the bounce keeps 45% of the vertical speed', () => {
  const g = fresh([0, -1, 0], [0, GRENADE.radius + 0.05, 0]);
  stepGrenade(g, 1 / 120, [], OPEN); // -16.2 m/s would move 0.135 m and cross the floor
  near(g.vy, 16.2 * 0.45, 1e-9);
  near(g.y, GRENADE.radius + 0.05);
});

test('wall: a grenade thrown into a box bounces back', () => {
  const wall = { min: [-2, 0, -3], max: [2, 4, -2] };
  const g = fresh([0, 0, -1], [0, 2, 0]);
  for (let i = 0; i < 30; i++) stepGrenade(g, 1 / 120, [wall], OPEN);
  assert.ok(g.vz > 0, 'moving away from the wall');
  assert.ok(g.z > -2 + GRENADE.radius - 1e-9);
});

test('a grenade comes to rest on the floor', () => {
  const g = fresh([0.7, 0.3, -0.648], [0, 1.6, 0]);
  for (let i = 0; i < 60; i++) stepGrenade(g, 1 / 30, [], OPEN);
  assert.equal(g.vy, 0);
  near(g.y, GRENADE.radius, 1e-2, 'rests within one sub-step of the floor');
  near(Math.hypot(g.vx, g.vz), 0, 1e-3);
});

test('never overlaps a map box and stays in bounds (many directions)', () => {
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const g = fresh([Math.sin(a) * 0.9, 0.43, Math.cos(a) * 0.9], [6 * Math.cos(a), 1.6, 12 * Math.sin(a)]);
    while (!g.exploded) {
      stepGrenade(g, 1 / 30, MAP.boxes, MAP.half);
      for (const b of MAP.boxes) assert.ok(!overlaps(g, b), `direction ${k} overlapped a box`);
      assert.ok(Math.abs(g.x) <= MAP.half - GRENADE.radius + 1e-9 && Math.abs(g.z) <= MAP.half - GRENADE.radius + 1e-9);
    }
  }
});

// ------------------------------------------------------------------ fuse
for (const hz of [30, 60, 120]) {
  test(`fuse: exactly 3 s at ${hz} Hz`, () => {
    const g = fresh();
    for (let i = 1; i < hz * 3; i++) stepGrenade(g, 1 / hz, MAP.boxes, MAP.half);
    assert.equal(g.exploded, false, 'one tick early');
    stepGrenade(g, 1 / hz, MAP.boxes, MAP.half);
    assert.equal(g.exploded, true);
  });
}

test('an exploded grenade does not move again', () => {
  const g = fresh();
  for (let i = 0; i < 90; i++) stepGrenade(g, 1 / 30, [], OPEN);
  const before = { ...g };
  stepGrenade(g, 1 / 30, [], OPEN);
  assert.deepEqual(g, before);
});

// ------------------------------------------------------------------ blast
const P = (x, z = 0) => ({ x, y: 0, z, yaw: 0 });
const C = [0, 0.1, 0];

test('blast: 100 at the centre, linear to 0 at 5 m from the nearest body point', () => {
  assert.equal(blastDamage(C, P(0), []), 100);
  assert.equal(blastDamage(C, P(1.4), []), 80); // nearest point x = 1.0
  assert.equal(blastDamage(C, P(3.4), []), 40);
  assert.equal(blastDamage(C, P(4.4), []), 20);
  assert.equal(blastDamage(C, P(5.4), []), 0);
  assert.equal(blastDamage(C, P(9), []), 0);
});

test('blast: the curve is diagonal-aware', () => {
  // nearest point (3, 0.1, 4) -> d = 5
  assert.equal(blastDamage(C, P(3.4, 4.4), []), 0);
  // nearest point (2.4, 0.1, 1.8) -> d = 3
  assert.equal(blastDamage(C, P(2.8, 2.2), []), 40);
});

test('blast: solid cover between the blast and the player blocks all damage', () => {
  const cover = { min: [1, 0, -1], max: [2, 3, 1] };
  assert.equal(blastDamage(C, P(3.4), [cover]), 0);
  assert.equal(blastDamage(C, P(-3.4), [cover]), 40, 'cover only protects the far side');
});

test('blast: a box beyond the player is not cover', () => {
  const behind = { min: [4, 0, -1], max: [5, 3, 1] };
  assert.equal(blastDamage(C, P(3.4), [behind]), 40);
});
