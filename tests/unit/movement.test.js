import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPlayer } from '../../src/shared/movement.js';
import { MAP } from '../../src/shared/map.js';
import { PLAYER, INPUT_DT } from '../../src/shared/constants.js';

// ---- helpers (fresh objects per call; no shared mutable state) ----
const mk = (o = {}) => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, ...o });
const cmd = (o = {}) => ({ fwd: 0, right: 0, jump: false, yaw: 0, ...o });
const near = (a, b, eps = 1e-9, msg = '') =>
  assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
// -0 safe equality (assert.equal uses Object.is)
const same = (a, b, msg = '') => assert.ok(a === b, `${msg} expected ${b}, got ${a}`);

const STEP = 5.6 / 60; // speed 5.6 * dt 1/60, hand computed (SPEC 32 walk speed)
const OPEN = []; // no boxes
const BIG = 1000; // huge arena

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

test('INPUT_DT constant is 1/60 (sanity for hand-computed expectations)', () => {
  near(INPUT_DT, 1 / 60, 1e-15);
});

test('stepPlayer returns the very same object it was given', () => {
  const p = mk();
  assert.equal(stepPlayer(p, cmd(), OPEN, BIG), p);
});

test('yaw 0, fwd=1 moves -Z by speed*dt and leaves X unchanged', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1 }), OPEN, BIG);
  near(p.z, -STEP);
  near(p.x, 0);
});

test('yaw 0, fwd=-1 moves +Z', () => {
  const p = stepPlayer(mk(), cmd({ fwd: -1 }), OPEN, BIG);
  near(p.z, STEP);
});

test('yaw 0, right=1 moves +X', () => {
  const p = stepPlayer(mk(), cmd({ right: 1 }), OPEN, BIG);
  near(p.x, STEP);
  near(p.z, 0);
});

test('yaw 0, right=-1 moves -X', () => {
  const p = stepPlayer(mk(), cmd({ right: -1 }), OPEN, BIG);
  near(p.x, -STEP);
});

test('yaw PI/2, fwd=1 moves toward -X (increasing yaw turns left)', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, yaw: Math.PI / 2 }), OPEN, BIG);
  near(p.x, -STEP);
  near(p.z, 0);
});

test('yaw PI, fwd=1 moves +Z', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, yaw: Math.PI }), OPEN, BIG);
  near(p.z, STEP);
  near(p.x, 0);
});

test('yaw PI/2, right=1 moves toward -Z (right hand of a player facing -X)', () => {
  const p = stepPlayer(mk(), cmd({ right: 1, yaw: Math.PI / 2 }), OPEN, BIG);
  near(p.z, -STEP);
  near(p.x, 0);
});

test('yaw 2PI behaves like yaw 0', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, yaw: 2 * Math.PI }), OPEN, BIG);
  near(p.z, -STEP);
  near(p.x, 0);
});

test('diagonal input (fwd=1,right=1) is not faster than straight: displacement length is speed*dt', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, right: 1 }), OPEN, BIG);
  near(Math.hypot(p.x, p.z), STEP);
});

test('diagonal displacement components are equal in magnitude at yaw 0', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, right: 1 }), OPEN, BIG);
  near(p.x, STEP / Math.SQRT2);
  near(p.z, -STEP / Math.SQRT2);
});

test('input vector of length > 1 (fwd=1,right=0.5) is capped to length 1', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, right: 0.5 }), OPEN, BIG);
  near(Math.hypot(p.x, p.z), STEP);
});

test('absurdly large input (fwd=100) is still capped to speed*dt', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 100 }), OPEN, BIG);
  near(Math.hypot(p.x, p.z), STEP);
});

test('input shorter than 1 is not scaled up (fwd=0.3 moves 0.3*speed*dt)', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 0.3 }), OPEN, BIG);
  near(p.z, -0.3 * STEP);
});

test('speed is independent of yaw, even for a huge yaw value', () => {
  const p = stepPlayer(mk(), cmd({ fwd: 1, yaw: 1e6 }), OPEN, BIG);
  near(Math.hypot(p.x, p.z), STEP, 1e-9);
});

test('60 steps of fwd=1 travel exactly one second of speed (5.6 units)', () => {
  const p = mk();
  for (let i = 0; i < 60; i++) stepPlayer(p, cmd({ fwd: 1 }), OPEN, BIG);
  near(p.z, -5.6, 1e-9);
});

test('no input stops horizontal motion immediately (no sliding)', () => {
  const p = stepPlayer(mk({ vx: 5, vz: -5 }), cmd(), OPEN, BIG);
  near(p.vx, 0);
  near(p.vz, 0);
  near(p.x, 0);
  near(p.z, 0);
});

test('standing on the floor keeps onGround true and vy exactly 0', () => {
  const p = stepPlayer(mk(), cmd(), OPEN, BIG);
  assert.equal(p.onGround, true);
  same(p.vy, 0);
  same(p.y, 0);
});

test('gravity: an airborne player gains vy of -gravity*dt (-32/60) per step', () => {
  const p = stepPlayer(mk({ y: 1000, onGround: false }), cmd(), OPEN, BIG);
  near(p.vy, -32 / 60);
  assert.equal(p.onGround, false);
});

test('gravity accumulates: after 60 airborne steps vy is -32', () => {
  const p = mk({ y: 100000, onGround: false });
  for (let i = 0; i < 60; i++) stepPlayer(p, cmd(), OPEN, BIG);
  near(p.vy, -32, 1e-9);
});

test('jump from the ground sets vy to jump minus one step of gravity (8 - 32/60) and clears onGround', () => {
  const p = stepPlayer(mk(), cmd({ jump: true }), OPEN, BIG);
  near(p.vy, 8 - 32 / 60);
  assert.equal(p.onGround, false);
});

test('jump without the jump flag does not leave the ground', () => {
  const p = stepPlayer(mk(), cmd({ jump: false }), OPEN, BIG);
  assert.equal(p.onGround, true);
  same(p.y, 0);
});

test('jump while airborne has no effect (only gravity applies)', () => {
  const p = stepPlayer(mk({ y: 5, vy: -1, onGround: false }), cmd({ jump: true }), OPEN, BIG);
  near(p.vy, -1 - 32 / 60);
});

test('a full jump peaks near v^2/2g (about 1.0, SPEC 32) and returns to the floor', () => {
  const p = mk();
  let peak = 0;
  stepPlayer(p, cmd({ jump: true }), OPEN, BIG);
  for (let i = 0; i < 200 && !p.onGround; i++) {
    peak = Math.max(peak, p.y);
    stepPlayer(p, cmd(), OPEN, BIG);
  }
  assert.ok(peak > 0.9 && peak < 1.1, `peak ${peak}`); // 64 / 64 = 1.0 m, minus discretisation
  assert.equal(p.onGround, true);
  same(p.y, 0);
  same(p.vy, 0);
});

test('holding jump does not double-jump mid-air', () => {
  const p = mk();
  stepPlayer(p, cmd({ jump: true }), OPEN, BIG);
  const vyAfterFirst = p.vy;
  stepPlayer(p, cmd({ jump: true }), OPEN, BIG);
  near(p.vy, vyAfterFirst - 32 / 60);
});

test('y never goes below 0 even with a huge downward velocity', () => {
  const p = stepPlayer(mk({ y: 0.05, vy: -1000, onGround: false }), cmd(), OPEN, BIG);
  assert.ok(p.y >= 0);
  same(p.y, 0);
  assert.equal(p.onGround, true);
});

test('walking into a wall never overlaps it and stops within one step of its face', () => {
  const wall = { min: [2, 0, -10], max: [3, 3, 10] };
  const p = mk({ x: 1 });
  for (let i = 0; i < 100; i++) {
    stepPlayer(p, cmd({ right: 1 }), [wall], BIG);
    assert.ok(p.x + PLAYER.radius <= 2 + 1e-9, `x=${p.x}`);
  }
  assert.ok(p.x >= 1.6 - STEP - 1e-9, `stopped too early at ${p.x}`);
});

test('walking into a wall diagonally slides along the other axis', () => {
  const wall = { min: [2, 0, -20], max: [3, 3, 20] };
  const p = mk({ x: 1 });
  for (let i = 0; i < 100; i++) stepPlayer(p, cmd({ right: 1, fwd: 1 }), [wall], BIG);
  assert.ok(p.x + PLAYER.radius <= 2 + 1e-9);
  assert.ok(p.z < -6.4 && p.z > -6.7, `z=${p.z}`); // 100 * STEP/sqrt2 = 6.6
});

test('sliding along Z is unaffected by being pressed against an X wall (velocity component zeroed only on hit axis)', () => {
  const wall = { min: [2, 0, -20], max: [3, 3, 20] };
  const a = mk({ x: 1.6 });
  stepPlayer(a, cmd({ right: 1, fwd: 1 }), [wall], BIG);
  assert.ok(a.z < -0.05, `z=${a.z}`);
});

test('landing on a box places the feet exactly on the box top', () => {
  const box = { min: [-5, 0, -5], max: [5, 1, 5] };
  const p = mk({ y: 3, onGround: false });
  for (let i = 0; i < 200 && !p.onGround; i++) stepPlayer(p, cmd(), [box], BIG);
  assert.equal(p.onGround, true);
  same(p.y, 1);
  same(p.vy, 0);
});

test('standing on a box top stays there with onGround true', () => {
  const box = { min: [-5, 0, -5], max: [5, 1, 5] };
  const p = mk({ y: 1 });
  for (let i = 0; i < 30; i++) stepPlayer(p, cmd(), [box], BIG);
  same(p.y, 1);
  assert.equal(p.onGround, true);
});

test('walking off the edge of a box makes the player fall back to the floor', () => {
  const box = { min: [-1, 0, -1], max: [1, 1, 1] };
  const p = mk({ x: 0.5, y: 1 });
  for (let i = 0; i < 100; i++) stepPlayer(p, cmd({ right: 1 }), [box], BIG);
  same(p.y, 0);
  assert.equal(p.onGround, true);
});

test('hitting a box ceiling while rising zeroes vy and keeps the head under the ceiling', () => {
  const ceiling = { min: [-5, 3, -5], max: [5, 4, 5] };
  const p = mk({ y: 1, vy: 20, onGround: false });
  stepPlayer(p, cmd(), [ceiling], BIG);
  same(p.vy, 0);
  assert.ok(p.y + PLAYER.height <= 3 + 1e-9, `head at ${p.y + PLAYER.height}`);
});

test('a player who cannot jump under a low ceiling never overlaps it', () => {
  const ceiling = { min: [-5, 2, -5], max: [5, 3, 5] };
  const p = mk();
  for (let i = 0; i < 60; i++) {
    stepPlayer(p, cmd({ jump: true }), [ceiling], BIG);
    assert.ok(p.y + PLAYER.height <= 2 + 1e-9 || p.y >= 3 - 1e-9, `y=${p.y}`);
  }
});

test('bounds: pushing +X for a long time ends exactly at half - radius', () => {
  const p = mk();
  for (let i = 0; i < 2000; i++) stepPlayer(p, cmd({ right: 1 }), OPEN, MAP.half);
  near(p.x, MAP.half - PLAYER.radius, 1e-9);
});

test('bounds: pushing -Z for a long time ends exactly at -(half - radius)', () => {
  const p = mk();
  for (let i = 0; i < 2000; i++) stepPlayer(p, cmd({ fwd: 1 }), OPEN, MAP.half);
  near(p.z, -(MAP.half - PLAYER.radius), 1e-9);
});

test('bounds: explicit small half parameter is honoured', () => {
  const p = mk();
  for (let i = 0; i < 200; i++) stepPlayer(p, cmd({ right: -1, fwd: -1 }), OPEN, 5);
  near(p.x, -(5 - PLAYER.radius), 1e-9);
  near(p.z, 5 - PLAYER.radius, 1e-9);
});

test('determinism: identical start and command sequence give bit-identical state', () => {
  const rnd = mulberry32(42);
  const cmds = Array.from({ length: 400 }, () =>
    cmd({ fwd: rnd() * 2 - 1, right: rnd() * 2 - 1, jump: rnd() < 0.1, yaw: rnd() * 20 - 10 }),
  );
  const s = MAP.spawns[0];
  const a = mk({ x: s.x, z: s.z });
  const b = mk({ x: s.x, z: s.z });
  for (const c of cmds) stepPlayer(a, { ...c });
  for (const c of cmds) stepPlayer(b, { ...c });
  for (const k of Object.keys(a)) assert.ok(Object.is(a[k], b[k]), `field ${k}`);
});

test('purity: stepPlayer does not consult Date.now, Math.random or performance.now', () => {
  const d = Date.now;
  const r = Math.random;
  const pn = performance.now;
  const boom = () => {
    throw new Error('impure call');
  };
  Date.now = boom;
  Math.random = boom;
  performance.now = boom;
  try {
    stepPlayer(mk(), cmd({ fwd: 1, jump: true }), OPEN, BIG);
  } finally {
    Date.now = d;
    Math.random = r;
    performance.now = pn;
  }
});

test('default arguments use MAP.boxes and MAP.half without throwing', () => {
  const s = MAP.spawns[0];
  const p = stepPlayer(mk({ x: s.x, z: s.z }), cmd({ fwd: 1 }));
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});

// ---- property-style ----
function overlapsAny(p, boxes) {
  const eps = 1e-9;
  return boxes.some(
    (b) =>
      p.x - PLAYER.radius < b.max[0] - eps &&
      p.x + PLAYER.radius > b.min[0] + eps &&
      p.y < b.max[1] - eps &&
      p.y + PLAYER.height > b.min[1] + eps &&
      p.z - PLAYER.radius < b.max[2] - eps &&
      p.z + PLAYER.radius > b.min[2] + eps,
  );
}

test('property: random walks from every spawn never overlap a box, leave bounds or go below the floor', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const rnd = mulberry32(seed * 7919);
    for (const [si, s] of MAP.spawns.entries()) {
      const p = mk({ x: s.x, z: s.z });
      for (let step = 0; step < 400; step++) {
        stepPlayer(
          p,
          cmd({
            fwd: rnd() * 2 - 1,
            right: rnd() * 2 - 1,
            jump: rnd() < 0.15,
            yaw: (rnd() * 2 - 1) * 50,
          }),
        );
        const where = `seed ${seed} spawn ${si} step ${step}`;
        assert.ok([p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite), `${where} finite`);
        assert.ok(Math.abs(p.x) <= MAP.half - PLAYER.radius + 1e-9, `${where} x=${p.x}`);
        assert.ok(Math.abs(p.z) <= MAP.half - PLAYER.radius + 1e-9, `${where} z=${p.z}`);
        assert.ok(p.y >= 0, `${where} y=${p.y}`);
        assert.equal(overlapsAny(p, MAP.boxes), false, `${where} overlaps a box at ${p.x},${p.y},${p.z}`);
      }
    }
  }
});

test('property: horizontal displacement per step never exceeds speed*dt', () => {
  const rnd = mulberry32(99);
  for (let i = 0; i < 300; i++) {
    const p = mk();
    stepPlayer(
      p,
      cmd({ fwd: rnd() * 2 - 1, right: rnd() * 2 - 1, yaw: rnd() * 12 - 6 }),
      OPEN,
      BIG,
    );
    assert.ok(Math.hypot(p.x, p.z) <= STEP + 1e-9, `iter ${i}`);
  }
});
