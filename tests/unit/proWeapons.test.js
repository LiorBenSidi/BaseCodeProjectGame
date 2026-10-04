// SPEC 31 (D-028): shared weapon models, character rig math, inspect pose. Pure parts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_MODELS, WEAPON_IDS, MATERIALS, weaponModel, weaponLength } from '../../src/client/weaponModels.js';
import { RIG, walkCycle, advancePhase, hitFlash, deathPose } from '../../src/client/characterRig.js';
import { pose, WEAPON_VIEW, INSPECT_MS } from '../../src/client/weaponView.js';
import { WEAPONS } from '../../src/shared/weapons.js';

const near = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ~ ${b}`);

test('every gameplay weapon has a model and a view hold; parts use known materials; lengths rank sniper > shotgun > rifle > smg > pistol', () => {
  for (const id of Object.keys(WEAPONS)) {
    assert.ok(WEAPON_MODELS[id], `model for ${id}`);
    assert.ok(WEAPON_VIEW[id], `view hold for ${id}`);
    for (const part of WEAPON_MODELS[id].parts) {
      assert.equal(part.length, 7, `${id} part shape`);
      assert.ok(['body', 'accent', 'wood', 'glass'].includes(part[6]), `${id} material ${part[6]}`);
      for (let i = 0; i < 3; i++) assert.ok(part[i] > 0 && part[i] < 1.2);
    }
    assert.ok(WEAPON_MODELS[id].muzzle < 0, 'muzzle toward -Z');
  }
  assert.deepEqual([...WEAPON_IDS].sort(), Object.keys(WEAPONS).sort());
  const L = Object.fromEntries(WEAPON_IDS.map((id) => [id, weaponLength(id)]));
  assert.ok(L.sniper > L.shotgun && L.shotgun > L.rifle && L.rifle > L.smg && L.smg > L.pistol, JSON.stringify(L));
  assert.equal(weaponModel('bogus'), WEAPON_MODELS.rifle);
  assert.ok(MATERIALS.body.metalness > MATERIALS.wood.metalness);
});

test('rig: standing still has straight legs and no bob; walking swings legs in antiphase; sprint leans; airborne tucks', () => {
  const still = walkCycle(1.2, 0);
  near(still.legL, 0); near(still.legR, 0); near(still.bob, 0);
  const walk = walkCycle(Math.PI / 2, 5.6);
  near(walk.legL, 0.75); near(walk.legR, -0.75);
  assert.ok(walk.armSwing < 0, 'arms counter the legs');
  const slow = walkCycle(Math.PI / 2, 2.8);
  assert.ok(Math.abs(slow.legL) < Math.abs(walk.legL), 'slower walk swings less');
  const crouch = walkCycle(Math.PI / 2, 2.8, { crouchK: 0.6 });
  assert.ok(Math.abs(crouch.legL) < Math.abs(slow.legL), 'crouched steps are shorter');
  assert.ok(walkCycle(0, 8.5).lean > walkCycle(0, 5.6).lean, 'sprint leans forward');
  const air = walkCycle(0, 7, { airborne: true });
  assert.ok(air.legL > 0 && air.legR < 0 && air.bob === 0);
  assert.ok(RIG.head[4] > RIG.torso[4] && RIG.torso[4] > RIG.pelvis[4] && RIG.hipY > RIG.leg[1] - 0.05, 'stacked from the feet up');
});

test('phase advances one cycle per 1.6 m whatever the speed; hit flash and death pose curves are bounded', () => {
  let p = 0;
  for (let i = 0; i < 100; i++) p = advancePhase(p, 1.6, 0.01); // 1.6 m in 1 s
  near(Math.sin(p), 0, 1e-6, 'one full cycle back to zero (mod 2 pi)');
  let q = 0;
  for (let i = 0; i < 50; i++) q = advancePhase(q, 3.2, 0.01); // same distance, twice the speed, half the time
  near(Math.sin(q), 0, 1e-6);
  assert.equal(hitFlash(-1), 0);
  assert.equal(hitFlash(0), 1);
  near(hitFlash(60), 0.5);
  assert.equal(hitFlash(120), 0);
  const d0 = deathPose(0), dMid = deathPose(225), dEnd = deathPose(450), dLate = deathPose(5000);
  assert.equal(d0.roll, 0); assert.equal(d0.sink, 0); assert.equal(d0.fade, 0);
  assert.ok(dMid.roll > 0 && dMid.roll < dEnd.roll && dMid.sink < dEnd.sink);
  assert.ok(dEnd.roll < Math.PI / 2 && dEnd.fade === 1 && dLate.fade === 1);
});

test('inspect pose: identity at 0 and 1, lifted and rolled at the midpoint, never while aiming (view model decides)', () => {
  const rest = pose({});
  const end = pose({ inspect: 1 });
  near(end.x, rest.x, 1e-12); near(end.roll, 0, 1e-12); near(end.yaw, 0, 1e-12);
  const mid = pose({ inspect: 0.5 });
  assert.ok(mid.roll > 1 && mid.yaw > 0.8 && mid.y > rest.y && mid.x < rest.x);
  assert.ok(INSPECT_MS >= 1000 && INSPECT_MS <= 2000);
  const kicked = pose({ kick: 1 });
  assert.ok(kicked.z > rest.z && kicked.pitch > rest.pitch, 'kick still pushes back and up');
});
