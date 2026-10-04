// SPEC 23: sprint, crouch, slide, step-up, mantle, wall jump, air control (pure movement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPlayer, heightOf, eyeOf } from '../../src/shared/movement.js';
import { INPUT_DT, PLAYER } from '../../src/shared/constants.js';
import { playerBox } from '../../src/shared/hitscan.js';
import { zoneAt } from '../../src/shared/combat.js';

const DT = INPUT_DT;
const fresh = (o = {}) => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, ...o });
const cmd = (o = {}) => ({ fwd: 0, right: 0, jump: false, yaw: 0, ...o });
// Every direct stepPlayer call passes its boxes: the arena default has a platform at the origin.
const step = (p, c, boxes = []) => stepPlayer(p, c, boxes, 40);
const box = (cx, cz, w, d, h, y0 = 0) => ({ min: [cx - w / 2, y0, cz - d / 2], max: [cx + w / 2, y0 + h, cz + d / 2] });
const run = (p, c, n, boxes = [], half = 40) => { for (let i = 0; i < n; i++) stepPlayer(p, c, boxes, half); return p; };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ~ ${b}`);

test('sprint: sprintMul speed in every direction (SPEC 32.1 omnimovement), nothing without input', () => {
  const p = run(fresh(), cmd({ fwd: 1, sprint: true }), 60);
  near(-p.z, PLAYER.speed * PLAYER.sprintMul);
  const q = run(fresh(), cmd({ right: 1, sprint: true }), 60);
  near(q.x, PLAYER.speed * PLAYER.sprintMul, 1e-9, 'strafe sprint');
  const r = run(fresh(), cmd({ fwd: -1, sprint: true }), 60);
  near(r.z, PLAYER.speed * PLAYER.sprintMul, 1e-9, 'backwards sprint');
  const s = run(fresh(), cmd({ sprint: true }), 60);
  near(s.x, 0); near(s.z, 0);
});

test('crouch: hitbox drops to crouchHeight at once, speed to crouchMul, eye follows; standing up needs head room', () => {
  const p = run(fresh(), cmd({ fwd: 1, crouch: true }), 60);
  assert.equal(heightOf(p), PLAYER.crouchHeight);
  near(eyeOf(p), PLAYER.eye * PLAYER.crouchHeight / PLAYER.height);
  near(-p.z, PLAYER.speed * PLAYER.crouchMul);
  assert.equal(playerBox(p).max[1], PLAYER.crouchHeight);
  // a ceiling at 1.4 m: crouched player fits, cannot stand
  const lid = box(0, 0, 10, 10, 1, 1.4);
  const q = run(fresh({ z: 0 }), cmd({ crouch: true }), 2, [lid]);
  run(q, cmd(), 5, [lid]);
  assert.equal(heightOf(q), PLAYER.crouchHeight, 'still crouched under the lid');
  run(q, cmd(), 5, []);
  assert.equal(heightOf(q), PLAYER.height, 'stands up in the open');
});

test('crouch: hit zones scale with the height, a crouched head is still a head', () => {
  const p = fresh({ h: PLAYER.crouchHeight, yaw: 0 });
  assert.equal(zoneAt(p, { x: 0, y: 1.1, z: 0 }), 'head');
  assert.equal(zoneAt(p, { x: 0, y: 0.3, z: 0 }), 'legs');
  assert.equal(zoneAt(fresh({ yaw: 0 }), { x: 0, y: 1.1, z: 0 }), 'lowerTorso', 'standing: 1.1 m is torso');
});

test('slide: sprint then tap crouch bursts to slideSpeed, decays over slideTime, keeps the low hitbox, and locks the direction', () => {
  const p = run(fresh(), cmd({ fwd: 1, sprint: true }), 5);
  step(p, cmd({ fwd: 1, sprint: true, crouch: true }));
  near(Math.hypot(p.vx, p.vz), PLAYER.slideSpeed, 1e-9);
  assert.equal(heightOf(p), PLAYER.crouchHeight);
  // steering input during the slide does not change the direction
  run(p, cmd({ right: 1, sprint: true, crouch: true }), 10);
  near(p.vx, 0);
  assert.ok(p.vz < 0);
  run(p, cmd({ fwd: 1, sprint: true, crouch: true }), Math.ceil(PLAYER.slideTime / DT) + 2);
  near(Math.hypot(p.vx, p.vz), PLAYER.speed * PLAYER.crouchMul, 1e-9);
  assert.equal(p.slide, 0);
});

test('slide: holding crouch does not re-trigger, and tapping crouch while walking only crouches', () => {
  const p = run(fresh(), cmd({ fwd: 1, sprint: true }), 5);
  run(p, cmd({ fwd: 1, sprint: true, crouch: true }), Math.ceil(PLAYER.slideTime / DT) + 5);
  assert.equal(p.slide, 0);
  near(Math.hypot(p.vx, p.vz), PLAYER.speed * PLAYER.crouchMul, 1e-9);
  const q = run(fresh(), cmd({ fwd: 1 }), 5);
  step(q, cmd({ fwd: 1, crouch: true }));
  assert.equal(q.slide, 0);
});

test('step-up: walking into a ledge up to stepHeight climbs it without a jump; a taller one blocks', () => {
  const low = box(0, -7, 4, 10, PLAYER.stepHeight);
  const p = run(fresh(), cmd({ fwd: 1 }), 40, [low]);
  near(p.y, low.max[1], 1e-3);
  assert.equal(p.onGround, true);
  const tall = box(0, -7, 4, 10, 1.0);
  const q = run(fresh(), cmd({ fwd: 1 }), 40, [tall]);
  assert.equal(q.y, 0);
  assert.ok(q.z >= tall.max[2] + PLAYER.radius - 1e-3, 'stopped at the face');
});

test('mantle: jumping into a 1.5 m ledge while moving grabs it and stands on top', () => {
  const ledge = box(0, -7, 4, 10, PLAYER.mantleHeight);
  const p = fresh();
  step(p, cmd({ fwd: 1, jump: true }), [ledge]);
  run(p, cmd({ fwd: 1 }), 60, [ledge]);
  near(p.y, ledge.max[1], 1e-3);
  assert.equal(p.onGround, true);
  assert.ok(p.z < ledge.max[2], 'standing on the ledge, not in front of it');
});

test('mantle: without a jump a 1.5 m ledge is a wall', () => {
  const ledge = box(0, -7, 4, 10, PLAYER.mantleHeight);
  const p = run(fresh(), cmd({ fwd: 1 }), 60, [ledge]);
  assert.equal(p.y, 0);
});

test('wall jump: airborne against a wall, a fresh jump press launches away from it, once per airtime', () => {
  const wall = box(0, -2.5, 10, 1, 6); // face at z = -2: reachable in the 0.5 s of air time at walking speed
  const p = fresh();
  step(p, cmd({ fwd: 1, jump: true }), [wall]);
  run(p, cmd({ fwd: 1, jump: false }), 20, [wall]); // reach the wall in the air
  assert.ok(!p.onGround && p.z <= wall.max[2] + PLAYER.radius + 1e-3);
  const vyBefore = p.vy;
  step(p, cmd({ fwd: 1, jump: true }), [wall]);
  assert.ok(p.vy > vyBefore && p.vy > 0, 'launched up');
  assert.ok(p.vz > 0, 'pushed away from the wall (+Z)');
  assert.equal(p.wallJumps, 0);
  // a second press in the same airtime does nothing
  run(p, cmd({ fwd: 1, jump: false }), 1, [wall]);
  run(p, cmd({ fwd: 1, jump: false }), 10, [wall]);
  const v = p.vy;
  step(p, cmd({ fwd: 1, jump: true }), [wall]);
  assert.ok(p.vy <= v, 'no second wall jump');
  run(p, cmd(), 120, [wall]);
  assert.equal(p.onGround, true);
  assert.equal(p.wallJumps, PLAYER.wallJumpsPerAir, 'reset on landing');
});

test('wall jump needs a fresh press: holding jump from the ground never wall jumps', () => {
  const wall = box(0, -3, 10, 1, 6);
  const p = fresh();
  run(p, cmd({ fwd: 1, jump: true }), 30, [wall]);
  assert.equal(p.wallJumps, PLAYER.wallJumpsPerAir);
});

test('air control: horizontal velocity changes by at most airAccel * dt per step in the air, keeps momentum without input', () => {
  const p = fresh({ y: 30, vy: 0, onGround: false }); // high up: 1.37 s of fall, enough air time to measure
  step(p, cmd({ right: 1 }));
  near(p.vx, PLAYER.airAccel * DT, 1e-9);
  run(p, cmd({ right: 1 }), 40); // 41 * 0.2 m/s = 8.2 > speed: saturates at the walking speed
  near(p.vx, PLAYER.speed, 1e-9);
  step(p, cmd());
  near(p.vx, PLAYER.speed, 1e-9, 'no input in the air keeps the momentum');
  // on the ground, no input still stops at once
  run(p, cmd(), 120);
  assert.equal(p.onGround, true);
  assert.equal(p.vx, 0);
});

test('determinism holds with the new fields', () => {
  const seq = [];
  for (let i = 0; i < 200; i++) seq.push(cmd({ fwd: (i % 7) / 7, right: ((i * 3) % 5) / 5 - 0.4, jump: i % 23 === 0, sprint: i % 3 === 0, crouch: i % 41 === 0, yaw: i * 0.05 }));
  const a = fresh();
  const b = fresh();
  const boxes = [box(0, -6, 4, 2, 0.5), box(5, 0, 2, 6, 1.5), box(-6, 3, 1, 10, 6)];
  for (const c of seq) { stepPlayer(a, c, boxes); stepPlayer(b, c, boxes); }
  assert.deepEqual(a, b);
});
