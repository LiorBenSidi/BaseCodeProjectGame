// SPEC 32: BO6 tuning, omnimovement sprint, tactical sprint, dive, slide cancel, mantle flag (pure movement, D-029).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPlayer, heightOf } from '../../src/shared/movement.js';
import { INPUT_DT, PLAYER } from '../../src/shared/constants.js';

const DT = INPUT_DT;
const fresh = (o = {}) => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, ...o });
const cmd = (o = {}) => ({ fwd: 0, right: 0, jump: false, yaw: 0, ...o });
const step = (p, c, boxes = []) => stepPlayer(p, c, boxes, 60);
const run = (p, c, n, boxes = []) => { for (let i = 0; i < n; i++) stepPlayer(p, c, boxes, 60); return p; };
const near = (a, b, eps = 1e-6, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ~ ${b}`);
const steps = (seconds) => Math.round(seconds / DT);

test('SPEC 32 tuning table: 5.6 / 7.2 / 8.5 m/s, crouch 2.8, 1.0 m jump apex', () => {
  near(PLAYER.speed, 5.6);
  near(PLAYER.speed * PLAYER.sprintMul, 7.2, 1e-9);
  near(PLAYER.speed * PLAYER.tacSprintMul, 8.5, 1e-9);
  near(PLAYER.speed * PLAYER.crouchMul, 2.8, 1e-9);
  near((PLAYER.jump * PLAYER.jump) / (2 * PLAYER.gravity), 1.0, 1e-9, 'apex');
  near(PLAYER.diveSpeed * PLAYER.diveTime, 2.5, 1e-9, 'dive distance');
});

test('tactical sprint: a fresh press while moving forward gives tacSprintMul speed for tacBurst seconds, then cooldown', () => {
  const p = fresh();
  step(p, cmd({ fwd: 1, tac: true }));
  near(-p.vz, PLAYER.speed * PLAYER.tacSprintMul, 1e-9, 'first step at tac speed');
  run(p, cmd({ fwd: 1, tac: true }), steps(PLAYER.tacBurst) - 2); // holding the key does not re-trigger
  near(-p.vz, PLAYER.speed * PLAYER.tacSprintMul, 1e-9, 'still tac sprinting just before the burst ends');
  run(p, cmd({ fwd: 1, tac: true }), 2);
  near(-p.vz, PLAYER.speed, 1e-9, 'burst over: walking (the key is still held, no sprint flag)');
  assert.ok(p.tacCd > 0 && p.tacCd <= PLAYER.tacCooldown, 'cooldown started');
  // a fresh press during the cooldown does nothing
  step(p, cmd({ fwd: 1 }));
  step(p, cmd({ fwd: 1, tac: true }));
  near(-p.vz, PLAYER.speed, 1e-9, 'no tac sprint during cooldown');
  run(p, cmd({ fwd: 1 }), steps(PLAYER.tacCooldown) + 1);
  step(p, cmd({ fwd: 1, tac: true }));
  near(-p.vz, PLAYER.speed * PLAYER.tacSprintMul, 1e-9, 'available again after the cooldown');
});

test('tactical sprint is forward only and ends when the forward input stops or the player crouches', () => {
  const q = fresh();
  step(q, cmd({ right: 1, tac: true }));
  near(q.vx, PLAYER.speed, 1e-9, 'strafe press does not start it');
  const p = fresh();
  step(p, cmd({ fwd: 1, tac: true }));
  step(p, cmd({ fwd: 0, tac: true }));
  assert.equal(p.tac, 0, 'ended by releasing forward');
  assert.ok(p.tacCd > 0, 'and the cooldown runs');
  const c = fresh();
  step(c, cmd({ fwd: 1, tac: true }));
  step(c, cmd({ fwd: 1, tac: true, crouch: true }));
  assert.equal(c.tac, 0, 'ended by crouching');
});

test('omnimovement slide: a crouch tap while sprinting backwards slides backwards and then decays to crouch speed', () => {
  const p = fresh();
  step(p, cmd({ fwd: -1, sprint: true }));
  step(p, cmd({ fwd: -1, sprint: true, crouch: true }));
  assert.ok(p.slide > 0, 'sliding');
  assert.ok(p.vz > PLAYER.speed * PLAYER.sprintMul, `slide is faster than sprint: ${p.vz}`);
  near(p.vz, PLAYER.slideSpeed, 0.3, 'starts near slideSpeed');
  assert.equal(heightOf(p), PLAYER.crouchHeight);
  run(p, cmd({ fwd: -1, sprint: true, crouch: true }), steps(PLAYER.slideTime) + 2);
  assert.equal(p.slide, 0, 'slide over');
  near(p.vz, PLAYER.speed * PLAYER.crouchMul, 1e-9, 'crouch walking afterwards');
});

test('slide cancel: a jump inside slideCancelWindow keeps the slide velocity through the jump; a late jump does not', () => {
  const early = fresh();
  step(early, cmd({ fwd: 1, sprint: true }));
  step(early, cmd({ fwd: 1, sprint: true, crouch: true }));
  run(early, cmd({ fwd: 1, sprint: true, crouch: true }), steps(0.1));
  const vBefore = -early.vz;
  step(early, cmd({ fwd: 1, sprint: true, crouch: false, jump: true }));
  assert.equal(early.slide, 0, 'slide cancelled');
  assert.equal(early.onGround, false, 'and the jump happened');
  assert.ok(-early.vz > PLAYER.speed * PLAYER.sprintMul, `momentum kept: ${-early.vz} vs sprint ${PLAYER.speed * PLAYER.sprintMul}`);
  assert.ok(-early.vz <= vBefore + 1e-9, 'no free speed beyond the slide velocity');

  const late = fresh();
  step(late, cmd({ fwd: 1, sprint: true }));
  step(late, cmd({ fwd: 1, sprint: true, crouch: true }));
  run(late, cmd({ fwd: 1, sprint: true, crouch: true }), steps(PLAYER.slideCancelWindow) + 3);
  step(late, cmd({ fwd: 1, sprint: true, crouch: false, jump: true }));
  assert.equal(late.onGround, false, 'the jump still happens');
  assert.ok(-late.vz < -early.vz, `but with the decayed slide speed only: ${-late.vz} < ${-early.vz}`);
  assert.ok(-late.vz < PLAYER.speed * PLAYER.sprintMul, 'below sprint speed by then');
});

test('dive: a fresh dive press while sprinting covers 2.5 m along the input over diveTime in the low hitbox, then stands', () => {
  const p = fresh();
  step(p, cmd({ right: 1, sprint: true }));
  const x0 = p.x;
  step(p, cmd({ right: 1, sprint: true, dive: true }));
  assert.ok(p.dive > 0, 'diving');
  assert.equal(heightOf(p), PLAYER.crouchHeight, 'low hitbox');
  near(p.vx, PLAYER.diveSpeed, 1e-9);
  // steering input is ignored while the dive is locked
  run(p, cmd({ fwd: -1, dive: true }), steps(PLAYER.diveTime) - 2);
  near(p.vz, 0, 1e-9, 'no steering during the dive');
  run(p, cmd({ dive: true }), 2);
  assert.equal(p.dive, 0, 'dive over');
  near(p.x - x0, 2.5, 0.05, 'distance covered');
  run(p, cmd(), 2);
  assert.equal(heightOf(p), PLAYER.height, 'stands back up in the open');
  // holding the key does not re-trigger, and walking (no sprint) never dives
  const w = fresh();
  step(w, cmd({ fwd: 1 }));
  step(w, cmd({ fwd: 1, dive: true }));
  assert.equal(w.dive, 0, 'no dive from a walk');
});

test('a dive cannot jump, and a dive during tactical sprint ends the burst and starts its cooldown', () => {
  const p = fresh();
  step(p, cmd({ fwd: 1, tac: true }));
  step(p, cmd({ fwd: 1, tac: true, dive: true }));
  assert.ok(p.dive > 0 && p.tac === 0 && p.tacCd > 0);
  step(p, cmd({ fwd: 1, jump: true }));
  assert.equal(p.onGround, true, 'no jump out of a dive');
});

test('mantled is set for exactly the step in which an airborne climb happened', () => {
  const ledge = { min: [-5, 0, -20], max: [5, 1.2, -1] }; // 1.2 m: too high to step, low enough to mantle; long enough to stay on
  const p = fresh({ z: 0 });
  let flagged = 0;
  for (let i = 0; i < 60; i++) {
    stepPlayer(p, cmd({ fwd: 1, jump: i === 0 }), [ledge], 60);
    if (p.mantled) flagged += 1;
  }
  assert.equal(flagged, 1, 'one mantle step');
  assert.equal(p.mantled, false, 'cleared afterwards');
  near(p.y, 1.2, 1e-9, 'standing on the ledge');
});
