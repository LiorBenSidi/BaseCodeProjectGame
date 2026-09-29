import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimDir, playerBox, rayAabb, castRay } from '../../src/shared/hitscan.js';

const near = (a, b, eps = 1e-9, msg = '') =>
  assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const nearVec = (v, w, eps = 1e-9) => {
  assert.equal(v.length, w.length);
  for (let i = 0; i < w.length; i++) near(v[i], w[i], eps, `component ${i}:`);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNIT = { min: [-1, -1, -1], max: [1, 1, 1] };

// ---------- aimDir ----------
test('aimDir(0,0) looks down -Z', () => nearVec(aimDir(0, 0), [0, 0, -1]));
test('aimDir(PI/2,0) looks toward -X', () => nearVec(aimDir(Math.PI / 2, 0), [-1, 0, 0]));
test('aimDir(PI,0) looks toward +Z', () => nearVec(aimDir(Math.PI, 0), [0, 0, 1]));
test('aimDir(3PI/2,0) looks toward +X', () => nearVec(aimDir((3 * Math.PI) / 2, 0), [1, 0, 0]));
test('positive pitch looks up: aimDir(0,PI/2) is +Y', () => nearVec(aimDir(0, Math.PI / 2), [0, 1, 0]));
test('negative pitch looks down: aimDir(0,-PI/2) is -Y', () => nearVec(aimDir(0, -Math.PI / 2), [0, -1, 0]));
test('aimDir(0,0.5) equals [0, sin .5, -cos .5] (hand-computed constants)', () =>
  nearVec(aimDir(0, 0.5), [0, 0.479425538604203, -0.8775825618903728]));
test('aimDir(PI/2, PI/4) is [-sqrt(.5), sqrt(.5), 0]', () =>
  nearVec(aimDir(Math.PI / 2, Math.PI / 4), [-0.7071067811865476, 0.7071067811865476, 0]));

test('aimDir returns a 3-element array', () => {
  const d = aimDir(1, 0.2);
  assert.ok(Array.isArray(d));
  assert.equal(d.length, 3);
});

test('property: aimDir always has length 1 (seeded random yaw/pitch, including huge yaw)', () => {
  const rnd = mulberry32(2024);
  for (let i = 0; i < 1000; i++) {
    const yaw = (rnd() * 2 - 1) * 1e4;
    const pitch = (rnd() * 2 - 1) * (Math.PI / 2);
    const d = aimDir(yaw, pitch);
    near(Math.hypot(d[0], d[1], d[2]), 1, 1e-12, `yaw ${yaw} pitch ${pitch}:`);
  }
});

// ---------- playerBox ----------
test('playerBox spans x±0.4, y..y+1.8, z±0.4 around the feet position', () => {
  const b = playerBox({ x: 1, y: 2, z: 3 });
  nearVec(b.min, [0.6, 2, 2.6]);
  nearVec(b.max, [1.4, 3.8, 3.4]);
});

test('playerBox ignores unrelated player fields and does not mutate the player', () => {
  const p = { x: -2, y: 0, z: 5, hp: 10, name: 'x', yaw: 3 };
  const copy = { ...p };
  const b = playerBox(p);
  nearVec(b.min, [-2.4, 0, 4.6]);
  nearVec(b.max, [-1.6, 1.8, 5.4]);
  assert.deepEqual(p, copy);
});

// ---------- rayAabb ----------
test('rayAabb: straight hit on the near face returns the distance', () => {
  near(rayAabb([0, 0, 10], [0, 0, -1], UNIT.min, UNIT.max), 9);
});

test('rayAabb: hit from the opposite side', () => {
  near(rayAabb([0, 0, -10], [0, 0, 1], UNIT.min, UNIT.max), 9);
});

test('rayAabb: hit along +X and -X and +Y and -Y', () => {
  near(rayAabb([-6, 0, 0], [1, 0, 0], UNIT.min, UNIT.max), 5);
  near(rayAabb([6, 0, 0], [-1, 0, 0], UNIT.min, UNIT.max), 5);
  near(rayAabb([0, -4, 0], [0, 1, 0], UNIT.min, UNIT.max), 3);
  near(rayAabb([0, 4, 0], [0, -1, 0], UNIT.min, UNIT.max), 3);
});

test('rayAabb: origin inside the box returns 0', () => {
  assert.equal(rayAabb([0.2, -0.3, 0.1], [0, 0, -1], UNIT.min, UNIT.max), 0);
});

test('rayAabb: origin inside the box returns 0 for any direction', () => {
  assert.equal(rayAabb([0, 0, 0], [1, 0, 0], UNIT.min, UNIT.max), 0);
  assert.equal(rayAabb([0, 0, 0], [0, -1, 0], UNIT.min, UNIT.max), 0);
});

test('rayAabb: a box entirely behind the ray is null', () => {
  assert.equal(rayAabb([0, 0, 10], [0, 0, 1], UNIT.min, UNIT.max), null);
});

test('rayAabb: ray pointing away along X from a box on its side is null', () => {
  assert.equal(rayAabb([5, 0, 0], [1, 0, 0], UNIT.min, UNIT.max), null);
});

test('rayAabb: ray parallel to a slab and outside it is null (x slab)', () => {
  assert.equal(rayAabb([5, 0, 10], [0, 0, -1], UNIT.min, UNIT.max), null);
});

test('rayAabb: ray parallel to a slab and outside it is null (y slab)', () => {
  assert.equal(rayAabb([0, 1.0001, 10], [0, 0, -1], UNIT.min, UNIT.max), null);
});

test('rayAabb: diagonal ray parallel to the z slab but outside it is null', () => {
  const s = Math.SQRT1_2;
  assert.equal(rayAabb([-5, -5, -5], [s, s, 0], UNIT.min, UNIT.max), null);
});

test('rayAabb: ray that just grazes the face plane inside the slab counts as a hit', () => {
  near(rayAabb([1, 0, 10], [0, 0, -1], UNIT.min, UNIT.max), 9);
});

test('rayAabb: ray that grazes an edge counts as a hit', () => {
  near(rayAabb([1, 1, 10], [0, 0, -1], UNIT.min, UNIT.max), 9);
});

test('rayAabb: ray just outside the edge misses', () => {
  assert.equal(rayAabb([1.000001, 1, 10], [0, 0, -1], UNIT.min, UNIT.max), null);
});

test('rayAabb: ray through the exact corner hits at the corner distance', () => {
  const k = 1 / Math.sqrt(3);
  near(rayAabb([-5, -5, -5], [k, k, k], UNIT.min, UNIT.max), 4 * Math.sqrt(3), 1e-9);
});

test('rayAabb: oblique hit on a non-cube box returns the entry distance', () => {
  // box x:[2,4] y:[-1,1] z:[-1,1]; ray from origin along +X hits at x=2
  near(rayAabb([0, 0, 0], [1, 0, 0], [2, -1, -1], [4, 1, 1]), 2);
});

test('rayAabb: the returned distance is never negative', () => {
  const rnd = mulberry32(5);
  for (let i = 0; i < 500; i++) {
    const o = [rnd() * 20 - 10, rnd() * 20 - 10, rnd() * 20 - 10];
    const d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const l = Math.hypot(...d) || 1;
    const t = rayAabb(o, d.map((v) => v / l), UNIT.min, UNIT.max);
    assert.ok(t === null || t >= 0, `t=${t}`);
  }
});

// ---------- castRay ----------
const target = (id, cx, cz) => ({
  id,
  box: { min: [cx - 0.4, 0, cz - 0.4], max: [cx + 0.4, 1.8, cz + 0.4] },
});
const ORIGIN = [0, 1.6, 0];
const FWD = [0, 0, -1];

test('castRay: empty world returns t = range and no target', () => {
  const r = castRay(ORIGIN, FWD, 120, [], []);
  near(r.t, 120);
  assert.equal(r.targetId, null);
});

test('castRay: a target in front is hit at its near face', () => {
  const r = castRay(ORIGIN, FWD, 120, [], [target('a', 0, -10)]);
  near(r.t, 9.6);
  assert.equal(r.targetId, 'a');
});

test('castRay: numeric target id 0 is returned as 0, not confused with no-hit', () => {
  const r = castRay(ORIGIN, FWD, 120, [], [target(0, 0, -10)]);
  assert.equal(r.targetId, 0);
});

test('castRay: a wall between shooter and target means no hit and t = wall distance', () => {
  const wall = { min: [-2, 0, -5.5], max: [2, 3, -5] };
  const r = castRay(ORIGIN, FWD, 120, [wall], [target('a', 0, -10)]);
  near(r.t, 5);
  assert.equal(r.targetId, null);
});

test('castRay: a target nearer than the wall is hit', () => {
  const wall = { min: [-2, 0, -20.5], max: [2, 3, -20] };
  const r = castRay(ORIGIN, FWD, 120, [wall], [target('a', 0, -10)]);
  near(r.t, 9.6);
  assert.equal(r.targetId, 'a');
});

test('castRay: a target and a wall at exactly the same distance is NOT a hit (strictly nearer required)', () => {
  const wall = { min: [-2, 0, -12], max: [2, 3, -9.6] }; // front face at z=-9.6
  const r = castRay(ORIGIN, FWD, 120, [wall], [target('a', 0, -10)]);
  near(r.t, 9.6);
  assert.equal(r.targetId, null);
});

test('castRay: a target beyond range is not hit and t = range', () => {
  const r = castRay(ORIGIN, FWD, 5, [], [target('a', 0, -10)]);
  near(r.t, 5);
  assert.equal(r.targetId, null);
});

test('castRay: a target whose near face is exactly at range is NOT a hit (strictly nearer than range)', () => {
  const r = castRay(ORIGIN, FWD, 9.6, [], [target('a', 0, -10)]);
  near(r.t, 9.6);
  assert.equal(r.targetId, null);
});

test('castRay: of two targets in a line the nearest wins regardless of array order', () => {
  const near1 = target('near', 0, -5);
  const far1 = target('far', 0, -10);
  assert.equal(castRay(ORIGIN, FWD, 120, [], [near1, far1]).targetId, 'near');
  assert.equal(castRay(ORIGIN, FWD, 120, [], [far1, near1]).targetId, 'near');
});

test('castRay: a target off to the side is missed', () => {
  const r = castRay(ORIGIN, FWD, 120, [], [target('a', 5, -10)]);
  assert.equal(r.targetId, null);
  near(r.t, 120);
});

test('castRay: nearest of several map boxes defines t', () => {
  const a = { min: [-1, 0, -30], max: [1, 3, -29] };
  const b = { min: [-1, 0, -8], max: [1, 3, -7] };
  const c = { min: [-1, 0, -15], max: [1, 3, -14] };
  near(castRay(ORIGIN, FWD, 120, [a, b, c], []).t, 7);
});

test('castRay: a map box that is behind the shooter is ignored', () => {
  const behind = { min: [-1, 0, 3], max: [1, 3, 4] };
  near(castRay(ORIGIN, FWD, 120, [behind], []).t, 120);
});

test('castRay: aiming above the target (pitch up) misses it', () => {
  const r = castRay(ORIGIN, aimDir(0, 0.3), 120, [], [target('a', 0, -10)]);
  assert.equal(r.targetId, null);
});

test('castRay: shooter origin inside a target box hits it at t=0 (nothing else nearer)', () => {
  const r = castRay([0, 1, 0], FWD, 120, [], [target('a', 0, 0)]);
  assert.equal(r.t, 0);
  assert.equal(r.targetId, 'a');
});
