// SPEC §15.4 (D-010 to D-015): verdicts, throws, grenade blasts and snapshots at room level.
// Scenes use the open east lane of the arena (x = 30, z from 0 to 35) and hand-computed expectations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { RESPAWN_MS, TICK_RATE } from '../../src/shared/constants.js';

const FUSE_TICKS = 3 * TICK_RATE; // 90 at 30 Hz
const DOWN = -1.5533; // the protocol's pitch clamp: straight down

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, ...opts });
  return { room, clock };
}

function join(room, name, x, z, yaw = 0, pitch = 0) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  Object.assign(p, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t) };
}

const shoot = (room, j) => { room.handleShoot(j.p.id); room.tick(); };
const ticks = (room, n) => { for (let i = 0; i < n; i++) room.tick(); };

// ------------------------------------------------------------------ verdicts
test('a miss still gets a verdict, to the shooter only', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30);
  const c = join(room, 'C', -30, -30);
  shoot(room, s);
  assert.deepEqual(s.of('verdict'), [{ t: 'verdict', target: null, zone: null, dmg: 0, dist: 70, kill: false }]);
  assert.equal(c.of('verdict').length, 0);
});

test('a level shot at 3.6 m is a head hit for 37.5', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30);
  const v = join(room, 'V', 30, 26);
  shoot(room, s);
  assert.deepEqual(s.of('verdict'), [{ t: 'verdict', target: v.p.id, zone: 'head', dmg: 37.5, dist: 3.6, kill: false }]);
  assert.equal(v.p.hp, 62.5);
  assert.deepEqual(s.of('hit'), [{ t: 'hit', id: v.p.id }], 'the baseline hit message is kept');
});

test('aiming low lands in the lower torso for 25', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30, 0, -Math.atan(0.6 / 3.6)); // impact 1.0 m above the feet
  const v = join(room, 'V', 30, 26);
  shoot(room, s);
  const [verdict] = s.of('verdict');
  assert.equal(verdict.zone, 'lowerTorso');
  assert.equal(verdict.dmg, 25);
  assert.equal(verdict.dist, 3.65);
  assert.equal(v.p.hp, 75);
});

test('at 24.6 m the second band applies: a head hit is 33', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30);
  const v = join(room, 'V', 30, 5);
  shoot(room, s);
  const [verdict] = s.of('verdict');
  assert.deepEqual([verdict.zone, verdict.dmg, verdict.dist], ['head', 33, 24.6]);
  assert.equal(v.p.hp, 67);
});

test('a killing shot reports the applied damage and kill: true', () => {
  const { room } = newRoom();
  const s = join(room, 'S', 30, 30);
  const v = join(room, 'V', 30, 26);
  v.p.hp = 10;
  shoot(room, s);
  const [verdict] = s.of('verdict');
  assert.equal(verdict.dmg, 10);
  assert.equal(verdict.kill, true);
  assert.deepEqual(s.of('kill'), [{ t: 'kill', killer: s.p.id, victim: v.p.id, killerName: 'S', victimName: 'V' }]);
});

test('a cooldown-rejected shot sends no verdict', () => {
  const { room, clock } = newRoom();
  const s = join(room, 'S', 30, 30);
  shoot(room, s);
  clock.t += 149;
  shoot(room, s);
  assert.equal(s.of('verdict').length, 1);
});

// ------------------------------------------------------------------ throws
test('a throw puts one grenade in every snapshot; a second throw in the same life does nothing', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30);
  const o = join(room, 'O', -30, -30);
  room.handleThrow(t.p.id);
  room.tick();
  room.handleThrow(t.p.id);
  room.tick();
  for (const j of [t, o]) {
    const nades = j.of('snap').at(-1).nades;
    assert.equal(nades.length, 1);
    assert.deepEqual(Object.keys(nades[0]).sort(), ['id', 'x', 'y', 'z']);
    assert.equal(nades[0].id, 1);
  }
  assert.equal(t.p.grenades, 0);
});

test('snapshots carry an empty nades list when nothing is in flight', () => {
  const { room } = newRoom();
  const a = join(room, 'A', 30, 30);
  room.tick();
  assert.deepEqual(a.of('snap').at(-1).nades, []);
});

test('the grenade explodes on exactly the 90th tick and leaves the snapshot', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30);
  const o = join(room, 'O', -30, -30);
  room.handleThrow(t.p.id);
  ticks(room, FUSE_TICKS - 1);
  assert.equal(o.of('boom').length, 0);
  room.tick();
  const [boom] = o.of('boom');
  assert.equal(boom.id, 1);
  assert.equal(boom.owner, t.p.id);
  assert.equal(boom.at.length, 3);
  assert.deepEqual(o.of('snap').at(-1).nades, []);
  assert.equal(t.of('boom').length, 1, 'everyone receives the boom');
});

test('a dead player cannot throw', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30);
  t.p.hp = 0;
  t.p.alive = false;
  t.p.respawnAt = Infinity;
  room.handleThrow(t.p.id);
  room.tick();
  assert.deepEqual(t.of('snap').at(-1).nades, []);
});

test('unknown ids are ignored by handleThrow', () => {
  const { room } = newRoom();
  assert.doesNotThrow(() => room.handleThrow(999));
});

// ------------------------------------------------------------------ blasts
test('self-damage: a grenade dropped at your feet kills you, counts a death and no kill (D-015)', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30, 0, DOWN);
  room.handleThrow(t.p.id);
  ticks(room, FUSE_TICKS);
  const [boom] = t.of('boom');
  assert.deepEqual(boom.hits, [{ id: t.p.id, dmg: 100, kill: true }]);
  assert.equal(t.p.alive, false);
  assert.equal(t.p.deaths, 1);
  assert.equal(t.p.kills, 0);
  assert.deepEqual(t.of('kill'), [{ t: 'kill', killer: t.p.id, victim: t.p.id, killerName: 'T', victimName: 'T' }]);
});

test('a grenade kill is credited to the thrower', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30, 0, DOWN);
  const v = join(room, 'V', 31, 30);
  v.p.hp = 10;
  room.handleThrow(t.p.id);
  ticks(room, FUSE_TICKS);
  assert.equal(v.p.alive, false);
  assert.equal(t.p.kills, 1);
  assert.ok(v.of('kill').some((k) => k.killer === t.p.id && k.victim === v.p.id));
});

test('cover blocks the blast; the same distance in the open does not (D-015)', () => {
  const { room } = newRoom();
  // The box at x 24.5..27.5, z -1.5..1.5 stands between the drop point (23, 0) and x = 28.
  const t = join(room, 'T', 23, 0, 0, DOWN);
  const covered = join(room, 'Covered', 28, 0);
  const open = join(room, 'Open', 18, 0);
  room.handleThrow(t.p.id);
  ticks(room, FUSE_TICKS);
  assert.equal(covered.p.hp, 100);
  assert.ok(open.p.hp < 100 && open.p.hp > 80, `open player took falloff damage, hp ${open.p.hp}`);
});

test('players beyond 5 m take no damage and are not listed in hits', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30, 0, DOWN);
  const far = join(room, 'Far', 30, 20);
  room.handleThrow(t.p.id);
  ticks(room, FUSE_TICKS);
  assert.equal(far.p.hp, 100);
  assert.ok(!t.of('boom')[0].hits.some((h) => h.id === far.p.id));
});

test('a grenade still explodes after its owner leaves', () => {
  const { room } = newRoom();
  const t = join(room, 'T', 30, 30, 0, DOWN);
  const v = join(room, 'V', 31, 30);
  room.handleThrow(t.p.id);
  room.tick();
  room.removePlayer(t.p.id);
  ticks(room, FUSE_TICKS - 1);
  assert.equal(v.of('boom').length, 1);
  assert.ok(v.p.hp < 100);
});

test('respawn restores the grenade', () => {
  const { room, clock } = newRoom();
  const t = join(room, 'T', 30, 30, 0, DOWN);
  room.handleThrow(t.p.id);
  ticks(room, FUSE_TICKS);
  assert.equal(t.p.grenades, 0);
  clock.t += RESPAWN_MS;
  room.tick();
  assert.equal(t.p.alive, true);
  assert.equal(t.p.grenades, 1);
});

// ------------------------------------------------------------------ load
test('a full room with 16 grenades in flight keeps each snapshot under 4096 bytes', () => {
  const { room } = newRoom();
  const all = [];
  for (let i = 0; i < 16; i++) all.push(join(room, `Player_Name_${String(i).padStart(4, '0')}`, -30 + i * 4, 30, 0, 0.3));
  for (const j of all) room.handleThrow(j.p.id);
  room.tick();
  const snap = all[0].of('snap').at(-1);
  assert.equal(snap.players.length, 16);
  assert.equal(snap.nades.length, 16);
  const bytes = Buffer.byteLength(JSON.stringify(snap));
  assert.ok(bytes < 4096, `snapshot is ${bytes} bytes`);
});
