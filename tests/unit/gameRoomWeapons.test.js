// SPEC 20: weapons at room level: magazines, reload, switch, pellets, snapshot fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { WEAPONS } from '../../src/shared/weapons.js';

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, ...opts });
  return { room, clock, advance: (ms) => { clock.t += ms; } };
}

function join(room, name, x, z, yaw = 0, pitch = 0) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  Object.assign(p, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}

const shoot = (room, j) => { room.handleShoot(j.p.id); room.tick(); };

test('snapshot carries weapon id, magazine, reserve and the reloading flag', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30);
  room.tick();
  const me = s.lastSnap().players[0];
  assert.equal(me.w, 'rifle');
  assert.equal(me.m, 30);
  assert.equal(me.r, 90);
  assert.equal(me.rel, 0);
});

test('every shot costs a round; an empty magazine fires nothing until a reload completes', () => {
  const { room, advance } = newRoom();
  const s = join(room, 'S', 30, 30);
  join(room, 'V', 30, 26);
  s.p.loadout.primary.mag = 2;
  shoot(room, s); advance(150);
  shoot(room, s); advance(150);
  assert.equal(s.of('shot').length, 2);
  shoot(room, s); advance(150);
  assert.equal(s.of('shot').length, 2, 'empty: no shot broadcast');
  assert.equal(s.of('verdict').length, 2, 'and no verdict');
  room.handleReload(s.p.id); room.tick();
  assert.equal(s.lastSnap().players[0].rel, 1);
  room.handleShoot(s.p.id); room.tick();
  assert.equal(s.of('shot').length, 2, 'reloading blocks the trigger');
  advance(WEAPONS.rifle.reloadMs); room.tick();
  const me = s.lastSnap().players[0];
  assert.equal(me.m, 30);
  assert.equal(me.r, 60);
  assert.equal(me.rel, 0);
  shoot(room, s);
  assert.equal(s.of('shot').length, 3);
});

test('switching to the pistol changes the weapon in the snapshot, the damage table and the interval', () => {
  const { room, advance } = newRoom();
  const s = join(room, 'S', 30, 30);
  const v = join(room, 'V', 30, 26);
  room.handleSwitch(s.p.id, 'sidearm'); room.tick();
  assert.equal(s.lastSnap().players[0].w, 'pistol');
  shoot(room, s);
  assert.equal(s.of('shot').length, 0, 'still switching');
  advance(WEAPONS.pistol.switchMs);
  shoot(room, s);
  assert.equal(s.of('shot').length, 1);
  assert.equal(s.of('shot')[0].w, 'pistol');
  // head at 3.6 m with the pistol: 22 * 1.5 = 33
  assert.equal(s.of('verdict')[0].dmg, 33);
  assert.equal(v.p.hp, 67);
  advance(WEAPONS.pistol.fireIntervalMs - 1);
  shoot(room, s);
  assert.equal(s.of('shot').length, 1, 'pistol interval is 220 ms');
  advance(1);
  shoot(room, s);
  assert.equal(s.of('shot').length, 2);
});

test('a shotgun fires one ray per pellet and sums the damage into one verdict', () => {
  let n = 0;
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4];
  const { room } = newRoom({ random: () => seq[n++ % seq.length] });
  const s = join(room, 'S', 30, 30);
  const v = join(room, 'V', 30, 27);
  s.p.loadout.primary = { ...s.p.loadout.primary, id: 'shotgun', mag: 8, reserve: 32, spread: WEAPONS.shotgun.spreadBase };
  shoot(room, s);
  assert.equal(s.of('shot').length, 8);
  assert.equal(s.lastSnap().players[0].m, 7);
  const [verdict] = s.of('verdict');
  assert.equal(verdict.target, v.p.id);
  assert.ok(verdict.dmg > 12, `pellets add up (${verdict.dmg})`);
  assert.equal(s.of('hit').length, 1, 'one hit message per victim, not per pellet');
  assert.equal(Math.round((100 - v.p.hp) * 100) / 100, verdict.dmg);
});

test('the respawned player gets a fresh default loadout', () => {
  const { room, advance } = newRoom();
  const s = join(room, 'S', 30, 30);
  room.handleSwitch(s.p.id, 'sidearm'); room.tick();
  s.p.loadout.sidearm.mag = 1;
  s.p.hp = 0; s.p.alive = false; s.p.respawnAt = 1000;
  advance(1); room.tick();
  assert.equal(s.p.alive, true);
  assert.equal(s.p.loadout.active, 'primary');
  assert.equal(s.p.loadout.sidearm.mag, 12);
});

test('dead players cannot reload or switch', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30);
  s.p.alive = false; s.p.respawnAt = Infinity;
  s.p.loadout.primary.mag = 1;
  room.handleReload(s.p.id); room.handleSwitch(s.p.id, 'sidearm'); room.tick();
  assert.equal(s.p.loadout.active, 'primary');
  assert.equal(s.p.loadout.primary.reloadingUntil, -Infinity);
});
