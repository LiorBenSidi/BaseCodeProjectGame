import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, newLoadout, fireBlock, recordShot, burstDue, startReload, switchSlot, activeWeapon, weaponDef, MELEE_STYLES, meleeStyle } from '../../src/shared/weapons.js';
import { applyPickup } from '../../src/shared/pickups.js';
import { PICKUP_TYPES } from '../../src/shared/rules.js';
import { MAPS } from '../../src/shared/maps.js';
import { GameRoom } from '../../src/server/GameRoom.js';

test('SPEC 38.1: a burst rifle pull fires three rounds 70 ms apart, then waits for the trigger interval', () => {
  const lo = newLoadout({ primary: 'burst_rifle', sidearm: 'pistol' });
  const ws = activeWeapon(lo);
  assert.equal(fireBlock(lo, 1000), null);
  recordShot(ws, 1000);
  assert.equal(ws.burstLeft, 2);
  assert.equal(fireBlock(lo, 1010), 'burst', 'the trigger is held by the burst');
  assert.equal(burstDue(ws, 1069), false);
  assert.equal(burstDue(ws, 1070), true);
  assert.equal(fireBlock(lo, 1070, true), null);
  recordShot(ws, 1070, true);
  assert.equal(ws.burstLeft, 1);
  recordShot(ws, 1140, true);
  assert.equal(ws.burstLeft, 0);
  assert.equal(ws.mag, 27);
  assert.equal(fireBlock(lo, 1200), 'interval');
  assert.equal(fireBlock(lo, 1140 + WEAPONS.burst_rifle.fireIntervalMs), null);
});

test('SPEC 38.1: an empty magazine, a reload or a switch ends a burst', () => {
  const lo = newLoadout({ primary: 'burst_rifle', sidearm: 'pistol' });
  const ws = activeWeapon(lo);
  ws.mag = 1;
  recordShot(ws, 1000);
  assert.equal(ws.burstLeft, 0, 'nothing left to fire');
  ws.mag = 10; recordShot(ws, 2000); assert.equal(ws.burstLeft, 2);
  assert.equal(startReload(lo, 2000), true); assert.equal(ws.burstLeft, 0);
  ws.reloadingUntil = -Infinity; recordShot(ws, 3000); assert.equal(ws.burstLeft, 2);
  assert.equal(switchSlot(lo, 'sidearm', 3000), true); assert.equal(ws.burstLeft, 0);
  // a single-shot weapon never queues
  const r = newLoadout(); recordShot(activeWeapon(r), 10); assert.equal(activeWeapon(r).burstLeft, 0);
});

test('SPEC 38.1: pickups follow the weapon slot; the revolver replaces the sidearm, not the rifle', () => {
  const p = { loadout: newLoadout() };
  const r = applyPickup({ type: 'revolver' }, p);
  assert.deepEqual(r, { kind: 'weapon', amount: 0, weapon: 'revolver' });
  assert.equal(p.loadout.primary.id, 'rifle');
  assert.equal(p.loadout.sidearm.id, 'revolver');
  assert.equal(applyPickup({ type: 'revolver' }, p), null, 'a full revolver is not picked up twice');
  assert.equal(applyPickup({ type: 'lmg' }, p).weapon, 'lmg');
  assert.equal(p.loadout.primary.id, 'lmg');
  for (const id of ['burst_rifle', 'lmg', 'revolver']) assert.equal(PICKUP_TYPES[id].weapon, id);
  // every map places at least one of the new weapons, and every pickup type exists
  for (const m of Object.values(MAPS)) {
    for (const s of m.pickups) assert.ok(PICKUP_TYPES[s.type], `${m.id} pickup ${s.type}`);
    assert.ok(m.pickups.some((s) => ['burst_rifle', 'lmg', 'revolver'].includes(s.type)), `${m.id} has a SPEC 38.1 weapon`);
  }
});

test('SPEC 38.1: the room fires burst follow-ups on its own ticks', () => {
  let now = 50_000;
  const room = new GameRoom({ now: () => now, random: () => 0.5, botFill: 0 });
  const inbox = [];
  const me = room.addPlayer({ send: (m) => inbox.push(m), name: 'Me' });
  me.loadout = newLoadout({ primary: 'burst_rifle', sidearm: 'pistol' });
  room.handleShoot(me.id);
  room.tick();
  const shots = () => inbox.filter((m) => m.t === 'shot' && m.id === me.id).length;
  assert.equal(shots(), 1);
  now += 33; room.tick(); assert.equal(shots(), 1, 'too early for the second round');
  now += 40; room.tick(); assert.equal(shots(), 2);
  now += 33; room.tick(); assert.equal(shots(), 2);
  now += 40; room.tick(); assert.equal(shots(), 3);
  now += 100; room.handleShoot(me.id); room.tick(); assert.equal(shots(), 3, 'the trigger interval holds');
  assert.equal(activeWeapon(me.loadout).mag, 27);
});

test('SPEC 38.3: every kit has a melee style with a sane window', () => {
  for (const [kit, st] of Object.entries(MELEE_STYLES)) {
    assert.equal(st.kit, kit);
    assert.ok(st.damage > 0 && st.range > 1 && st.windupMs > 0 && st.activeMs > 0 && st.recoveryMs > 0, kit);
  }
  assert.equal(meleeStyle('nope'), MELEE_STYLES.vanguard);
  assert.equal(weaponDef('revolver').slot, 'sidearm');
});
