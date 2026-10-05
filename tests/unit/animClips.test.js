import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleClip, bobClip, drawClip, reloadClip, inspectClip, fireClip, meleeClip, clashClip, compose, thirdPersonMelee, CLIP_MS } from '../../src/client/animClips.js';
import { MELEE_STYLES } from '../../src/shared/weapons.js';
import { DEFAULT_BINDINGS, ACTION_LABELS } from '../../src/client/bindings.js';

test('SPEC 38.2: the draw clip starts below the frame and settles to zero', () => {
  const start = drawClip(0);
  assert.ok(start.y < -0.3 && start.pitch < -0.8);
  const done = drawClip(1);
  for (const k of ['x', 'y', 'z', 'pitch', 'yaw', 'roll']) assert.ok(Math.abs(done[k]) < 1e-9, k);
  assert.ok(drawClip(0.5).y > start.y && drawClip(0.5).y < 0);
});

test('SPEC 38.2: the reload clip dips, tilts toward the eye and moves the left hand out then back', () => {
  assert.ok(reloadClip(0.5).y < -0.1 && reloadClip(0.5).pitch < -0.5);
  assert.ok(reloadClip(0.3).leftHand.drop > 0.15, 'magazine out');
  assert.ok(reloadClip(0.3).leftHand.drop > reloadClip(0.95).leftHand.drop, 'back on the weapon at the end');
  assert.ok(Math.abs(reloadClip(0).y) < 1e-9 && Math.abs(reloadClip(1).y) < 1e-9);
});

test('SPEC 38.2: idle, bob, inspect and fire clips are bounded and sprint lowers the weapon', () => {
  for (let t = 0; t < 10; t += 0.37) assert.ok(Math.abs(idleClip(t).y) <= 0.004 + 1e-9);
  const walk = bobClip(1.2, 1, false);
  const sprint = bobClip(1.2, 1, true);
  assert.ok(sprint.y < walk.y && sprint.pitch > walk.pitch && sprint.yaw < 0, 'sprint drops and angles the weapon');
  assert.ok(Math.abs(bobClip(1.2, 0, true).x) < 1e-9, 'no bob when still');
  assert.ok(inspectClip(0.5).yaw > 0.8 && Math.abs(inspectClip(1).yaw) < 1e-9);
  assert.ok(fireClip(1).z > 0.05 && fireClip(0).z === 0);
});

test('SPEC 38.3: the melee clip runs windup (back), active (across), recovery (settle) in the style timings', () => {
  const st = MELEE_STYLES.vanguard;
  assert.equal(meleeClip('vanguard', -1), null);
  assert.equal(meleeClip('vanguard', st.windupMs + st.activeMs + st.recoveryMs), null);
  const w = meleeClip('vanguard', st.windupMs - 1);
  assert.equal(w.phase, 'windup'); assert.ok(w.swing < -0.9, 'pulled back');
  const mid = meleeClip('vanguard', st.windupMs + st.activeMs / 2);
  assert.equal(mid.phase, 'active'); assert.ok(Math.abs(mid.swing) < 0.1, 'crossing the centre');
  const a = meleeClip('vanguard', st.windupMs + st.activeMs - 1);
  assert.ok(a.swing > 0.9 && a.yaw > 1, 'fully across');
  const r = meleeClip('vanguard', st.windupMs + st.activeMs + st.recoveryMs - 1);
  assert.equal(r.phase, 'recovery'); assert.ok(Math.abs(r.swing) < 0.05);
  assert.ok(Math.abs(meleeClip('medic', MELEE_STYLES.medic.windupMs + MELEE_STYLES.medic.activeMs - 1).yaw) < Math.abs(a.yaw), 'dual knives: a shorter arc');
});

test('SPEC 38.3: the clash clip knocks back and is shorter for the riposte', () => {
  const s = clashClip(10, false);
  assert.ok(s.z > 0.1 && s.pitch > 0.3);
  assert.ok(clashClip(CLIP_MS.clash * 0.5, true) === null, 'the riposte is already free');
  assert.ok(clashClip(CLIP_MS.clash * 0.5, false) !== null);
  assert.equal(clashClip(CLIP_MS.clash, false), null);
});

test('SPEC 38.2: compose adds offsets and carries hints; third person phases map onto the clip', () => {
  const c = compose({ x: 1, pitch: 0.5 }, null, { x: 2, leftHand: { drop: 1 } });
  assert.equal(c.x, 3); assert.equal(c.pitch, 0.5); assert.equal(c.yaw, 0); assert.deepEqual(c.leftHand, { drop: 1 });
  assert.equal(thirdPersonMelee('vanguard', 0, 0), null);
  const wu = thirdPersonMelee('vanguard', 1, 0);
  const ac = thirdPersonMelee('vanguard', 2, MELEE_STYLES.vanguard.activeMs - 1);
  assert.ok(ac.bladeAngle > wu.bladeAngle, 'the blade travels across during the active window');
  const cl = thirdPersonMelee('vanguard', 4, 0);
  assert.ok(cl.shake > 0.9 && thirdPersonMelee('vanguard', 4, CLIP_MS.clash).shake === 0);
});

test('SPEC 38.3: melee is bound to the middle mouse button by default and has a label', () => {
  assert.equal(DEFAULT_BINDINGS.melee, 'Mouse1');
  assert.ok(ACTION_LABELS.melee);
});
