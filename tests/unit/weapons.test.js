// SPEC 20: weapons table and state machine (pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEAPONS, WEAPON_IDS, newLoadout, activeWeapon, fireBlock, canFire, recordShot, decaySpread,
  startReload, finishReloadIfDue, switchSlot, addReserve, spreadDir, weaponDef,
} from '../../src/shared/weapons.js';
import { RIFLE } from '../../src/shared/combatData.js';
import { bandDamage } from '../../src/shared/combat.js';

test('table: five weapons, rifle identical to the milestone 1 rifle', () => {
  assert.deepEqual(WEAPON_IDS, ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']);
  assert.equal(WEAPONS.rifle.fireIntervalMs, RIFLE.cooldownMs);
  assert.equal(WEAPONS.rifle.range, RIFLE.range);
  assert.deepEqual(WEAPONS.rifle.bands, RIFLE.bands);
  assert.equal(bandDamage(WEAPONS.rifle, 10), 25);
  for (const id of WEAPON_IDS) {
    const d = WEAPONS[id];
    assert.ok(d.magSize > 0 && d.reserve >= d.magSize && d.reloadMs > 0 && d.fireIntervalMs > 0, id);
    assert.ok(d.bands.length >= 3 && d.bands.at(-1).below === d.range, `${id} last band ends at range`);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.bands));
  }
  assert.throws(() => weaponDef('bazooka'), RangeError);
});

test('loadout starts with a full rifle in hand and a pistol holstered', () => {
  const lo = newLoadout();
  assert.equal(lo.active, 'primary');
  assert.equal(activeWeapon(lo).id, 'rifle');
  assert.equal(activeWeapon(lo).mag, 30);
  assert.equal(lo.sidearm.id, 'pistol');
  assert.equal(fireBlock(lo, 0), null);
});

test('fire interval, empty magazine and reload gate the trigger with a named reason', () => {
  const lo = newLoadout();
  const ws = activeWeapon(lo);
  recordShot(ws, 1000);
  assert.equal(fireBlock(lo, 1000 + 149), 'interval');
  assert.equal(fireBlock(lo, 1000 + 150), null);
  ws.mag = 0;
  assert.equal(fireBlock(lo, 2000), 'empty');
  assert.equal(startReload(lo, 2000), true);
  assert.equal(fireBlock(lo, 2000), 'reloading');
  assert.equal(finishReloadIfDue(ws, 2000 + 1999), false);
  assert.equal(finishReloadIfDue(ws, 2000 + 2000), true);
  assert.equal(ws.mag, 30);
  assert.equal(ws.reserve, 60);
  assert.equal(canFire(lo, 4000), true);
});

test('reload refuses a full magazine, an empty reserve, and a reload already running', () => {
  const lo = newLoadout();
  assert.equal(startReload(lo, 0), false, 'full');
  const ws = activeWeapon(lo);
  ws.mag = 3;
  assert.equal(startReload(lo, 0), true);
  assert.equal(startReload(lo, 10), false, 'already reloading');
  finishReloadIfDue(ws, 2000);
  ws.mag = 0; ws.reserve = 0;
  assert.equal(startReload(lo, 3000), false, 'no reserve');
  ws.reserve = 5; ws.mag = 0;
  startReload(lo, 3000); finishReloadIfDue(ws, 5000);
  assert.equal(ws.mag, 5, 'partial reload takes what is left');
  assert.equal(ws.reserve, 0);
});

test('switching slots costs switchMs, cancels a reload, and refuses the slot already in hand', () => {
  const lo = newLoadout();
  activeWeapon(lo).mag = 1;
  startReload(lo, 0);
  assert.equal(switchSlot(lo, 'primary', 10), false);
  assert.equal(switchSlot(lo, 'sidearm', 10), true);
  assert.equal(lo.active, 'sidearm');
  assert.equal(lo.primary.reloadingUntil, -Infinity, 'reload cancelled');
  assert.equal(lo.primary.mag, 1, 'rounds stay where they were');
  assert.equal(fireBlock(lo, 10), 'switching');
  assert.equal(fireBlock(lo, 10 + 250), null);
  assert.equal(switchSlot(lo, 'primary', 20), false, 'no switch while switching');
  assert.equal(switchSlot(lo, 'knife', 1000), false);
});

test('spread grows per shot up to the cap and decays back to the base', () => {
  const lo = newLoadout();
  const ws = activeWeapon(lo);
  for (let i = 0; i < 20; i++) recordShot(ws, i * 150);
  assert.equal(ws.spread, WEAPONS.rifle.spreadMax);
  decaySpread(ws, 10_000);
  assert.equal(ws.spread, WEAPONS.rifle.spreadBase);
  recordShot(ws, 0);
  decaySpread(ws, 150);
  assert.equal(ws.spread, 0, 'one rifle shot per interval stays exact');
});

test('spreadDir: zero spread is exact and consumes no randomness; a cone stays inside its angle', () => {
  let calls = 0;
  const random = () => { calls += 1; return 0.37; };
  const dir = [0, 0, -1];
  assert.deepEqual(spreadDir(dir, 0, random), dir);
  assert.equal(calls, 0);
  for (const seed of [0.01, 0.5, 0.99]) {
    const out = spreadDir(dir, 0.1, () => seed);
    const dot = out[0] * dir[0] + out[1] * dir[1] + out[2] * dir[2];
    assert.ok(Math.acos(Math.min(1, dot)) <= 0.1 + 1e-9, `inside cone for seed ${seed}`);
    assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-9, 'unit length');
  }
  const up = spreadDir([0, 1, 0], 0.05, () => 0.5);
  assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-9, 'straight up still has a basis');
});

test('addReserve caps at twice the starting reserve', () => {
  const ws = newLoadout().primary;
  assert.equal(addReserve(ws, 1000), 90);
  assert.equal(ws.reserve, 180);
  assert.equal(addReserve(ws, 10), 0);
});
