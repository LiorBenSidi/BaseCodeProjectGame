// SPEC 32 client feel layer (pure parts): bindings, camera feel curves, aim assist, event bus, stick helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS, ACTIONS, bind, isBound, setBinding, resetBindings, loadBindings, conflicts, getAllBindings } from '../../src/client/bindings.js';
import { CameraFeel, calculateLandingDip, calculateHeadBob, calculateFovOffset, calculateSlideTilt, calculateMantleDip } from '../../src/client/cameraFeel.js';
import { applyAimAssist, findTargetInCone, viewDir, AIM_ASSIST } from '../../src/client/aimAssist.js';
import { eventBus } from '../../src/client/eventBus.js';
import { applyDeadzone, stickCurve } from '../../src/client/input.js';
import { RECOIL_RECOVERY_MS, WEAPONS } from '../../src/shared/weapons.js';

const near = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ~ ${b}`);

test('bindings: defaults match the shipped controls, Alt keys count, setters validate, conflicts are reported', () => {
  resetBindings();
  assert.equal(bind('fwd'), 'KeyW');
  assert.equal(bind('ability1'), 'KeyQ');
  assert.equal(bind('ability2'), 'KeyE');
  assert.equal(bind('weapon1'), 'Digit1');
  assert.equal(bind('grenade'), 'KeyG');
  assert.equal(bind('dive'), 'KeyV');
  assert.ok(isBound('sprint', 'ShiftRight'), 'Alt key');
  assert.ok(isBound('crouch', 'ControlLeft'));
  assert.ok(!isBound('crouch', 'KeyX'));
  assert.equal(bind('nope'), null);
  assert.equal(setBinding('nope', 'KeyX'), false, 'unknown action');
  assert.equal(setBinding('fwd', 42), false, 'non-string code');
  assert.equal(setBinding('fwd', ''), false);
  assert.ok(setBinding('fwd', 'ArrowUp'));
  assert.equal(bind('fwd'), 'ArrowUp');
  assert.deepEqual(conflicts(), [], 'no conflicts by default');
  setBinding('reload', 'KeyG');
  assert.deepEqual(conflicts(), [{ code: 'KeyG', actions: ['reload', 'grenade'] }]);
  const n = loadBindings({ fwd: 'KeyI', __proto__: { jump: 'KeyX' }, bogus: 'KeyB', jump: 7 });
  assert.equal(n, 1, 'only the valid entry applied');
  assert.equal(bind('fwd'), 'KeyI');
  assert.equal(bind('jump'), 'Space', 'reset before load');
  assert.equal(Object.keys(getAllBindings()).length, ACTIONS.length);
  resetBindings();
  assert.deepEqual(getAllBindings(), { ...DEFAULT_BINDINGS });
});

test('camera feel: landing dip scales with fall speed and decays; bob is zero in ADS; sprint fov; slide tilt; mantle dip', () => {
  assert.equal(calculateLandingDip(0), 0);
  assert.equal(calculateLandingDip(-0.5), 0, 'a tiny drop has no dip');
  assert.ok(calculateLandingDip(-6) > calculateLandingDip(-3), 'harder falls dip more');
  assert.ok(calculateLandingDip(-100) <= 0.25, 'capped');
  assert.deepEqual(calculateHeadBob(7, 5.6, true, 0.3), { x: 0, y: 0 });
  assert.deepEqual(calculateHeadBob(0.05, 5.6, false, 0.3), { x: 0, y: 0 }, 'standing still');
  const slow = calculateHeadBob(2.8, 5.6, false, 0.157);
  const fast = calculateHeadBob(7.2, 5.6, false, 0.157);
  assert.ok(Math.abs(fast.y) > Math.abs(slow.y), 'faster bobs more');
  assert.equal(calculateFovOffset(false, false), 0);
  assert.equal(calculateFovOffset(true, false), 5);
  assert.equal(calculateFovOffset(true, true), 8);
  near(calculateSlideTilt(true), (3 * Math.PI) / 180);
  assert.equal(calculateSlideTilt(false), 0);
  assert.equal(calculateMantleDip(0), 0);
  assert.ok(calculateMantleDip(0.075) < 0, 'dips at mid mantle');
  const f = new CameraFeel();
  f.onLanding(-8);
  const first = f.step(1 / 60, { speed: 0 });
  assert.ok(first.offsetY < 0, 'camera lowered right after landing');
  let last = first;
  for (let i = 0; i < 60; i++) last = f.step(1 / 60, { speed: 0 });
  near(last.offsetY, 0, 1e-9, 'recovered within a second');
  f.onMantle();
  const m = f.step(1 / 60, { speed: 0 });
  assert.ok(m.offsetY < 0, 'mantle dip');
  const s = f.step(1 / 60, { speed: 7.2, isSprinting: true, isSliding: true });
  assert.equal(s.fovKick, 5);
  near(s.rollTilt, (3 * Math.PI) / 180);
});

test('aim assist: never for the mouse; slows and pulls inside the cone for sticks and touch; ignores far, near and off-cone targets', () => {
  const player = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
  const ahead = { x: 0.3, y: 1.6, z: -10 }; // slightly right of centre, 10 m ahead
  const mouse = applyAimAssist({ inputType: 'mouse', aimDelta: { dyaw: 0.01, dpitch: 0 }, player, targets: [ahead] });
  assert.deepEqual(mouse, { dyaw: 0.01, dpitch: 0, target: null });
  const pad = applyAimAssist({ inputType: 'gamepad', aimDelta: { dyaw: 0.01, dpitch: 0 }, player, targets: [ahead] });
  assert.equal(pad.target, ahead);
  // the target sits at negative yaw (to the right); the pull reduces a leftward turn
  assert.ok(pad.dyaw < 0.01 * AIM_ASSIST.slowdownMul + 1e-12, `slowed and pulled right: ${pad.dyaw}`);
  const still = applyAimAssist({ inputType: 'touch', aimDelta: { dyaw: 0, dpitch: 0 }, player, targets: [ahead], moving: false });
  assert.equal(still.dyaw, 0, 'no drift while standing still with no turn');
  const movingPull = applyAimAssist({ inputType: 'touch', aimDelta: { dyaw: 0, dpitch: 0 }, player, targets: [ahead], moving: true });
  assert.ok(movingPull.dyaw < 0, 'moving pulls toward the target');
  near(Math.abs(movingPull.dyaw), Math.abs(Math.atan2(-0.3, 10)) * AIM_ASSIST.rotationalAssist, 1e-9, 'rotational fraction');
  assert.equal(findTargetInCone(player, [{ x: 0, y: 1.6, z: -80 }]), null, 'beyond maxDistance');
  assert.equal(findTargetInCone(player, [{ x: 0, y: 1.6, z: -1 }]), null, 'inside minDistance');
  assert.equal(findTargetInCone(player, [{ x: 5, y: 1.6, z: -10 }]), null, '26 degrees off: outside the cone');
  assert.equal(findTargetInCone(player, [{ x: 0, y: 1.6, z: 10 }]), null, 'behind');
  const two = findTargetInCone(player, [{ x: 1, y: 1.6, z: -10 }, { x: 0.2, y: 1.6, z: -10 }]);
  assert.equal(two.target.x, 0.2, 'closest to the centre wins');
  near(viewDir(0, 0)[2], -1);
  near(viewDir(Math.PI / 2, 0)[0], -1, 1e-9, '+yaw looks toward -X');
  near(viewDir(0, Math.PI / 2)[1], 1, 1e-9, '+pitch looks up');
});

test('event bus: subscribe, unsubscribe, a throwing listener does not stop the others', () => {
  eventBus.clear();
  const got = [];
  const off = eventBus.on('kill', (p) => got.push(p));
  eventBus.on('kill', () => { throw new Error('boom'); });
  eventBus.on('kill', (p) => got.push(`second ${p}`));
  const origError = console.error;
  console.error = () => {};
  try { eventBus.emit('kill', 'a'); } finally { console.error = origError; }
  assert.deepEqual(got, ['a', 'second a']);
  off();
  console.error = () => {};
  try { eventBus.emit('kill', 'b'); } finally { console.error = origError; }
  assert.deepEqual(got, ['a', 'second a', 'second b']);
  assert.equal(typeof eventBus.on('x', 'not a function'), 'function', 'bad listener is a no-op unsubscribe');
  eventBus.clear();
});

test('stick helpers and recoil recovery constant', () => {
  assert.equal(applyDeadzone(0.1), 0);
  near(applyDeadzone(1), 1);
  near(applyDeadzone(-1), -1);
  assert.ok(applyDeadzone(0.16) > 0 && applyDeadzone(0.16) < 0.02, 'starts from zero at the deadzone edge');
  near(stickCurve(1), 1);
  near(stickCurve(-1), -1);
  assert.ok(stickCurve(0.5) < 0.5, 'fine control near the centre');
  assert.equal(RECOIL_RECOVERY_MS, 120);
  for (const w of Object.values(WEAPONS)) assert.ok(w.adsMs > 0 && w.adsSensMul > 0 && w.adsSensMul <= 1, w.id);
  assert.equal(WEAPONS.sniper.adsSensMul, 0.65);
});
