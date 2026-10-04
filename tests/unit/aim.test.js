import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampFov, targetFov, sensitivityScale, isScoped, stepFov, DEFAULT_FOV, MIN_FOV, MAX_FOV, adsSensitivity, adsLerpRate, stepFovFor } from '../../src/client/aim.js';
import { pose, REST, ADS_POS, WEAPON_VIEW } from '../../src/client/weaponView.js';
import { WEAPONS } from '../../src/shared/weapons.js';

test('fov clamps and ADS targets', () => {
  assert.equal(clampFov('abc'), DEFAULT_FOV);
  assert.equal(clampFov(10), MIN_FOV);
  assert.equal(clampFov(500), MAX_FOV);
  assert.equal(clampFov(90.4), 90);
  assert.equal(targetFov(90, 'sniper', false), 90);
  assert.equal(targetFov(90, 'sniper', true), 28);
  assert.equal(targetFov(60, 'shotgun', true), 60, 'ADS never widens the view');
  assert.equal(targetFov(90, 'unknown', true), 58);
  assert.ok(sensitivityScale(28, 80) < 0.4 && sensitivityScale(80, 80) === 1);
  assert.equal(isScoped('sniper', true), true);
  assert.equal(isScoped('rifle', true), false);
  assert.ok(Math.abs(stepFov(80, 28, 1) - 28) < 1e-9, 'a whole second lands on the target');
  assert.ok(stepFov(80, 28, 0.016) < 80 && stepFov(80, 28, 0.016) > 28);
});

test('weapon view: every weapon has a layout, the pose moves from hip to centred under ADS', () => {
  for (const id of Object.keys(WEAPONS)) assert.ok(WEAPON_VIEW[id], `${id} layout`);
  const hip = pose({});
  assert.deepEqual([hip.x, hip.y, hip.z], [REST.x, REST.y, REST.z]);
  const ads = pose({ ads: 1 });
  assert.deepEqual([ads.x, ads.y, ads.z], [ADS_POS.x, ADS_POS.y, ADS_POS.z]);
  assert.ok(pose({ kick: 1 }).z > hip.z, 'kick pushes the weapon back');
  assert.ok(pose({ reload: 1 }).y < hip.y, 'reload dips the weapon');
  assert.ok(pose({ ads: 1, swayX: 0.5 }).x === ADS_POS.x, 'no sway while aiming');
});

test('SPEC 32.4: ADS sensitivity multiplier and per-weapon ADS time', () => {
  const zoom = sensitivityScale(58, 80);
  assert.ok(Math.abs(adsSensitivity(58, 80, 'rifle', true) - zoom * 0.8) < 1e-12, 'rifle multiplies by 0.8');
  assert.ok(Math.abs(adsSensitivity(28, 80, 'sniper', true) - sensitivityScale(28, 80) * 0.65) < 1e-12, 'sniper 0.65');
  assert.equal(adsSensitivity(80, 80, 'rifle', false), 1, 'no multiplier when not aiming');
  assert.ok(adsLerpRate('smg') > adsLerpRate('rifle') && adsLerpRate('rifle') > adsLerpRate('sniper'), 'faster weapons aim faster');
  assert.ok(Math.abs(adsLerpRate('rifle') - 12) < 1e-9, '3 / 250 ms');
  assert.equal(adsLerpRate('nope'), adsLerpRate('rifle'), 'unknown weapon uses the rifle timing');
  // after adsMs the fov is within 5% of the way to the target (e^-3 of the gap remains)
  let fov = 80;
  for (let i = 0; i < 25; i++) fov = stepFovFor(fov, 58, 0.01, 'rifle');
  assert.ok(Math.abs(fov - 58) < (80 - 58) * 0.06, `fov ${fov} after 250 ms`);
});
