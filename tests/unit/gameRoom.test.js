import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, MAX_CMDS_PER_TICK, MAX_QUEUE } from '../../src/server/GameRoom.js';
import { MAP } from '../../src/shared/map.js';
import { aimDir, castRay } from '../../src/shared/hitscan.js';
import { MAX_HP, MAX_PLAYERS, PLAYER, RESPAWN_MS, TICK_RATE, WEAPON } from '../../src/shared/constants.js';
import { SPAWN } from '../../src/shared/rules.js';

// ------------------------------------------------------------------ helpers
const STEP = 7 / 60; // one movement step at full speed, hand computed
// D-010/D-014: a level eye-height shot at 4-8 m lands in the head zone: 25 x 1.5 = 37.5 (hand computed).
const LEVEL_HIT = 37.5;
const near = (a, b, eps = 1e-6, msg = '') =>
  assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newRoom({ start = 1000, random = () => 0, ...rest } = {}) {
  const clock = { t: start, advance(ms) { this.t += ms; } };
  const room = new GameRoom({ now: () => clock.t, random, ...rest });
  return { room, clock };
}

function join(room, name) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  return { p, inbox, of: (type) => inbox.filter((m) => m.t === type) };
}

const lastSnap = (j) => j.of('snap').at(-1);
const entry = (snap, id) => snap.players.find((e) => e.id === id);

function place(p, pos, yaw, pitch = 0) {
  p.x = pos.x;
  p.y = 0;
  p.z = pos.z;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.yaw = yaw;
  p.pitch = pitch;
}

function cmdf(seq, yaw = 0, o = {}) {
  return { seq, fwd: 0, right: 0, jump: false, yaw, pitch: 0, ...o };
}

// --- find, from the real map, geometry the tests can rely on ---
const DIRS = [
  { yaw: 0, dx: 0, dz: -1 },
  { yaw: Math.PI / 2, dx: -1, dz: 0 },
  { yaw: Math.PI, dx: 0, dz: 1 },
  { yaw: (3 * Math.PI) / 2, dx: 1, dz: 0 },
];

function standingOverlapsBox(x, z, pad = 0.05) {
  const r = PLAYER.radius + pad;
  return MAP.boxes.some(
    (b) =>
      x - r < b.max[0] && x + r > b.min[0] && 0 < b.max[1] && PLAYER.height > b.min[1] && z - r < b.max[2] && z + r > b.min[2],
  );
}

function findOpenLine(dist) {
  const half = MAP.half;
  for (let x = -half + 2; x <= half - 2; x += 1) {
    for (let z = -half + 2; z <= half - 2; z += 1) {
      for (const d of DIRS) {
        const tx = x + d.dx * dist;
        const tz = z + d.dz * dist;
        if (Math.abs(tx) > half - 1 || Math.abs(tz) > half - 1) continue;
        if (standingOverlapsBox(x, z) || standingOverlapsBox(tx, tz)) continue;
        const r = castRay([x, PLAYER.eye, z], aimDir(d.yaw, 0), WEAPON.range, MAP.boxes, []);
        if (r.t < dist + 2) continue;
        return { x, z, d };
      }
    }
  }
  return null;
}

function findWall() {
  for (const b of MAP.boxes) {
    if (b.min[1] < PLAYER.eye - 0.1 && b.max[1] > PLAYER.eye + 0.1) {
      const cz = (b.min[2] + b.max[2]) / 2;
      return { shooter: { x: b.min[0] - 3, z: cz }, target: { x: b.max[0] + 3, z: cz }, yaw: (3 * Math.PI) / 2 };
    }
  }
  return null;
}

const OPEN = findOpenLine(8);
const WALL = findWall();

// scene: shooter S facing victim V (4 units ahead) + bystander C behind the shooter, all placed explicitly
function scene(opts = {}) {
  const { room, clock } = newRoom(opts);
  const line = OPEN;
  const at = (k) => ({ x: line.x + line.d.dx * k, z: line.z + line.d.dz * k });
  const S = join(room, 'Shooter');
  const V = join(room, 'Victim');
  const C = join(room, 'Bystander');
  place(S.p, at(0), line.d.yaw);
  place(V.p, at(4), line.d.yaw + Math.PI);
  place(C.p, at(-3), line.d.yaw);
  const fire = () => {
    room.handleShoot(S.p.id);
    room.tick();
  };
  const progress = (p) => line.d.dx * (p.x - line.x) + line.d.dz * (p.z - line.z);
  return { room, clock, S, V, C, at, fire, line, progress };
}

const needOpen = { skip: OPEN ? false : 'map has no clear 8-unit line for a duel' };
const needWall = { skip: WALL ? false : 'map has no box crossing eye height' };

// ------------------------------------------------------------------ constants
test('MAX_CMDS_PER_TICK is 4', () => assert.equal(MAX_CMDS_PER_TICK, 4));
test('MAX_QUEUE is 12', () => assert.equal(MAX_QUEUE, 12));

// ------------------------------------------------------------------ addPlayer
test('first player gets id 1, second id 2', () => {
  const { room } = newRoom();
  assert.equal(join(room, 'a').p.id, 1);
  assert.equal(join(room, 'b').p.id, 2);
});

test('ids are never reused after a player is removed', () => {
  const { room } = newRoom();
  join(room, 'a');
  const b = join(room, 'b');
  room.removePlayer(b.p.id);
  assert.equal(join(room, 'c').p.id, 3);
});

test('ids are never reused even when the lowest id leaves', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  join(room, 'b');
  room.removePlayer(a.p.id);
  const c = join(room, 'c');
  assert.equal(c.p.id, 3);
});

test('addPlayer sends exactly one welcome with id and tickRate before returning', () => {
  const { room } = newRoom();
  const j = join(room, 'a');
  // SPEC 22: the first player also receives the matchStart that follows the welcome.
  assert.deepEqual(j.inbox.map((m) => m.t), ['welcome', 'matchStart']);
  const [w] = j.inbox;
  assert.equal(w.t, 'welcome');
  assert.equal(w.id, 1);
  assert.equal(w.tickRate, TICK_RATE);
  assert.deepEqual(w.pickups.map((pk) => pk.type), MAP.pickups.map((pk) => pk.type), 'SPEC 21.1: the welcome lists the pickup spots');
  assert.equal(TICK_RATE, 30);
});

test('a new player starts with full hp, alive, zero score and lastSeq -1', () => {
  const { room } = newRoom();
  const { p } = join(room, 'a');
  assert.equal(p.hp, MAX_HP);
  assert.equal(p.alive, true);
  assert.equal(p.kills, 0);
  assert.equal(p.deaths, 0);
  assert.equal(p.lastSeq, -1);
});

test('a new player stands at y=0', () => {
  const { room } = newRoom();
  assert.ok(join(room, 'a').p.y === 0);
});

test('the spawn is chosen with Math.floor(random() * spawns.length): every spawn index is reachable', () => {
  const n = MAP.spawns.length;
  for (let i = 0; i < n; i++) {
    const { room } = newRoom({ random: () => (i + 0.5) / n });
    const { p } = join(room, 'a');
    assert.equal(p.x, MAP.spawns[i].x, `spawn ${i} x`);
    assert.equal(p.z, MAP.spawns[i].z, `spawn ${i} z`);
    assert.equal(p.yaw, MAP.spawns[i].yaw, `spawn ${i} yaw`);
  }
});

test('random() just below 1 picks the last spawn, random() 0 picks the first', () => {
  const last = MAP.spawns.at(-1);
  const first = MAP.spawns[0];
  const a = join(newRoom({ random: () => 0.9999999 }).room, 'a').p;
  const b = join(newRoom({ random: () => 0 }).room, 'b').p;
  assert.deepEqual([a.x, a.z], [last.x, last.z]);
  assert.deepEqual([b.x, b.z], [first.x, first.z]);
});

test('name is sanitized on join', () => {
  const { room } = newRoom();
  const p = join(room, '  Bob   the  <b>Builder</b>  ').p;
  assert.ok(!/[<>]/.test(p.name), p.name);
  assert.ok([...p.name].length <= 16);
  assert.match(p.name, /^Bob the /);
});

test('an empty / non-string / markup-only name becomes Player<id>', () => {
  const { room } = newRoom();
  assert.equal(join(room, '').p.name, 'Player1');
  assert.equal(join(room, undefined).p.name, 'Player2');
  assert.equal(join(room, '<>').p.name, 'Player3');
  assert.equal(join(room, 12345).p.name, 'Player4');
});

test('addPlayer returns null when the room is full and does not welcome the rejected player', () => {
  const { room } = newRoom({ maxPlayers: 2 });
  join(room, 'a');
  join(room, 'b');
  const rejected = join(room, 'c');
  assert.equal(rejected.p, null);
  assert.equal(rejected.inbox.length, 0);
  assert.equal(room.playerCount, 2);
});

test('maxPlayers defaults to MAX_PLAYERS (16)', () => {
  const { room } = newRoom();
  for (let i = 0; i < MAX_PLAYERS; i++) assert.ok(join(room, `p${i}`).p, `player ${i}`);
  assert.equal(join(room, 'extra').p, null);
  assert.equal(MAX_PLAYERS, 16);
});

test('a slot freed by removePlayer can be filled again', () => {
  const { room } = newRoom({ maxPlayers: 1 });
  const a = join(room, 'a');
  assert.equal(join(room, 'b').p, null);
  room.removePlayer(a.p.id);
  assert.ok(join(room, 'b').p);
});

test('playerCount tracks adds and removes', () => {
  const { room } = newRoom();
  assert.equal(room.playerCount, 0);
  const a = join(room, 'a');
  join(room, 'b');
  assert.equal(room.playerCount, 2);
  room.removePlayer(a.p.id);
  assert.equal(room.playerCount, 1);
});

// ------------------------------------------------------------------ removePlayer
test('removePlayer returns true once, then false; unknown ids return false', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  assert.equal(room.removePlayer(a.p.id), true);
  assert.equal(room.removePlayer(a.p.id), false);
  assert.equal(room.removePlayer(999), false);
  assert.equal(room.removePlayer(undefined), false);
});

test('a removed player receives no more snapshots and is absent from others snapshots', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  const b = join(room, 'b');
  room.tick();
  room.removePlayer(a.p.id);
  const before = a.inbox.length;
  room.tick();
  assert.equal(a.inbox.length, before);
  assert.deepEqual(lastSnap(b).players.map((e) => e.id), [b.p.id]);
});

test('removing a player with a pending shot and queued input does not break the next tick', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  const b = join(room, 'b');
  room.handleShoot(a.p.id);
  room.handleInput(a.p.id, [cmdf(1)]);
  room.removePlayer(a.p.id);
  assert.doesNotThrow(() => room.tick());
  assert.equal(lastSnap(b).players.length, 1);
});

// ------------------------------------------------------------------ unknown ids
test('handleInput, handleShoot with an unknown id are ignored without throwing or creating players', () => {
  const { room } = newRoom();
  assert.doesNotThrow(() => room.handleInput(42, [cmdf(1)]));
  assert.doesNotThrow(() => room.handleShoot(42));
  assert.doesNotThrow(() => room.tick());
  assert.equal(room.playerCount, 0);
});

test('room works with no logger and with a logger stub', () => {
  const calls = [];
  const logger = { debug: (...a) => calls.push(a), info: (...a) => calls.push(a), warn: (...a) => calls.push(a), error: (...a) => calls.push(a) };
  const { room } = newRoom({ logger });
  const a = join(room, 'a');
  room.handleInput(a.p.id, [cmdf(1)]);
  assert.doesNotThrow(() => room.tick());
  const bare = newRoom().room;
  join(bare, 'a');
  assert.doesNotThrow(() => bare.tick());
});

// ------------------------------------------------------------------ snapshots
test('tick counter starts at 1 and increments per tick for every player', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  const b = join(room, 'b');
  room.tick();
  room.tick();
  room.tick();
  assert.deepEqual(a.of('snap').map((s) => s.tick), [1, 2, 3]);
  assert.deepEqual(b.of('snap').map((s) => s.tick), [1, 2, 3]);
});

test('every player gets exactly one snapshot per tick', () => {
  const { room } = newRoom();
  const js = [join(room, 'a'), join(room, 'b'), join(room, 'c')];
  room.tick();
  for (const j of js) assert.equal(j.of('snap').length, 1);
});

test('snapshot entry has exactly the documented keys', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.tick();
  const e = entry(lastSnap(a), a.p.id);
  // SPEC 20.4 added w, m, r, rel (weapon in hand, magazine, reserve, reloading flag).
  // SPEC 21.2 added sp (spawn protection).
  assert.deepEqual(Object.keys(e).sort(), ['alive', 'd', 'g', 'hp', 'id', 'k', 'm', 'name', 'pitch', 'r', 'rel', 'sp', 'tm', 'vy', 'w', 'x', 'y', 'yaw', 'z']);
});

test('snapshot numbers are rounded to 3 decimals', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  Object.assign(a.p, { x: 1.23456, y: 0.0004, z: -7.65432, vy: -0.00051, yaw: 3.14159265, pitch: -0.7071067 });
  room.tick();
  const e = entry(lastSnap(a), a.p.id);
  assert.ok(e.x === 1.235, `x=${e.x}`);
  assert.ok(e.y === 0, `y=${e.y}`);
  assert.ok(e.z === -7.654, `z=${e.z}`);
  assert.ok(e.vy === -0.001, `vy=${e.vy}`);
  assert.ok(e.yaw === 3.142, `yaw=${e.yaw}`);
  assert.ok(e.pitch === -0.707, `pitch=${e.pitch}`);
});

test('snapshot encodes onGround as g=1/0 and alive as 1/0', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  a.p.onGround = true;
  room.tick();
  assert.strictEqual(entry(lastSnap(a), a.p.id).g, 1);
  assert.strictEqual(entry(lastSnap(a), a.p.id).alive, 1);
  a.p.onGround = false;
  room.tick();
  assert.strictEqual(entry(lastSnap(a), a.p.id).g, 0);
});

test('snapshot carries name, hp, kills (k) and deaths (d)', () => {
  const { room } = newRoom();
  const a = join(room, 'Zed');
  a.p.hp = 60;
  a.p.kills = 3;
  a.p.deaths = 2;
  room.tick();
  const e = entry(lastSnap(a), a.p.id);
  assert.equal(e.name, 'Zed');
  assert.equal(e.hp, 60);
  assert.equal(e.k, 3);
  assert.equal(e.d, 2);
});

test('snapshot lists every player, each player sees the same set', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  const b = join(room, 'b');
  const c = join(room, 'c');
  room.tick();
  for (const j of [a, b, c]) assert.deepEqual(lastSnap(j).players.map((e) => e.id).sort(), [1, 2, 3]);
});

test('ack in a snapshot is the receiving players own lastSeq', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  const b = join(room, 'b');
  room.handleInput(a.p.id, [cmdf(5)]);
  room.tick();
  assert.equal(lastSnap(a).ack, 5);
  assert.equal(lastSnap(b).ack, -1);
});

test('tick with no players does not throw', () => {
  assert.doesNotThrow(() => newRoom().room.tick());
});

test('a send() that throws does not stop other players from getting their snapshot', () => {
  const { room } = newRoom();
  let boom = false;
  const a = room.addPlayer({ send: () => { if (boom) throw new Error('socket closed'); }, name: 'a' });
  const b = join(room, 'b');
  boom = true;
  assert.doesNotThrow(() => room.tick());
  assert.equal(b.of('snap').length, 1);
  assert.equal(a.alive, true);
  assert.doesNotThrow(() => room.tick());
  assert.equal(b.of('snap').length, 2);
});

test('a send() that throws does not stop shot/hit/kill events from reaching the others', { ...needOpen }, () => {
  const s = scene();
  let boom = false;
  const bad = s.room.addPlayer({ send: () => { if (boom) throw new Error('dead socket'); }, name: 'Bad' });
  place(bad, s.at(-6), s.line.d.yaw);
  boom = true;
  s.V.p.hp = WEAPON.damage;
  assert.doesNotThrow(() => s.fire());
  assert.equal(s.C.of('shot').length, 1);
  assert.equal(s.C.of('kill').length, 1);
  assert.equal(s.S.of('hit').length, 1);
});

// ------------------------------------------------------------------ input queue
test('a cmd advances lastSeq and the position by one step in the commanded direction', needOpen, () => {
  const s = scene();
  s.room.handleInput(s.S.p.id, [cmdf(1, s.line.d.yaw, { fwd: 1 })]);
  s.room.tick();
  assert.equal(s.S.p.lastSeq, 1);
  near(s.progress(s.S.p), STEP, 1e-9);
});

test('yaw and pitch from a consumed cmd are copied to the player', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.handleInput(a.p.id, [cmdf(1, 1.25, { pitch: 0.5 })]);
  room.tick();
  assert.equal(a.p.yaw, 1.25);
  assert.equal(a.p.pitch, 0.5);
});

test('at most MAX_CMDS_PER_TICK cmds are consumed per tick, oldest first', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.handleInput(a.p.id, Array.from({ length: 10 }, (_, i) => cmdf(i + 1)));
  room.tick();
  assert.equal(lastSnap(a).ack, 4);
  room.tick();
  assert.equal(lastSnap(a).ack, 8);
  room.tick();
  assert.equal(lastSnap(a).ack, 10);
  room.tick();
  assert.equal(lastSnap(a).ack, 10);
});

test('a tick consumes four cmds worth of movement, not more', needOpen, () => {
  const s = scene();
  s.room.handleInput(s.S.p.id, Array.from({ length: 6 }, (_, i) => cmdf(i + 1, s.line.d.yaw, { fwd: 1 })));
  s.room.tick();
  near(s.progress(s.S.p), 4 * STEP, 1e-9);
});

test('queue overflow drops the OLDEST cmds: 20 queued keeps seq 9..20', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.handleInput(a.p.id, Array.from({ length: 20 }, (_, i) => cmdf(i + 1)));
  room.tick();
  assert.equal(lastSnap(a).ack, 12); // first consumed is seq 9, four of them: 9..12
  room.tick();
  assert.equal(lastSnap(a).ack, 16);
  room.tick();
  assert.equal(lastSnap(a).ack, 20);
});

test('a queue holding exactly MAX_QUEUE cmds drops nothing', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.handleInput(a.p.id, Array.from({ length: 12 }, (_, i) => cmdf(i + 1)));
  room.tick();
  assert.equal(lastSnap(a).ack, 4); // seq 1 was kept
});

test('duplicate seq inside one call is dropped (replay protection)', needOpen, () => {
  const s = scene();
  const y = s.line.d.yaw;
  s.room.handleInput(s.S.p.id, [cmdf(5, y, { fwd: 1 }), cmdf(5, y, { fwd: 1 }), cmdf(4, y, { fwd: 1 }), cmdf(6, y, { fwd: 1 })]);
  s.room.tick();
  assert.equal(s.S.p.lastSeq, 6);
  near(s.progress(s.S.p), 2 * STEP, 1e-9); // only seq 5 and 6 simulated
});

test('a replayed seq in a second call while the first is still queued is dropped', needOpen, () => {
  const s = scene();
  const y = s.line.d.yaw;
  s.room.handleInput(s.S.p.id, [cmdf(5, y, { fwd: 1 })]);
  s.room.handleInput(s.S.p.id, [cmdf(5, y, { fwd: 1 })]);
  s.room.handleInput(s.S.p.id, [cmdf(3, y, { fwd: 1 })]);
  s.room.tick();
  near(s.progress(s.S.p), 1 * STEP, 1e-9);
});

test('cmds with a lower seq than one already queued are dropped even if in the same call, order preserved otherwise', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.handleInput(a.p.id, [cmdf(7), cmdf(6), cmdf(8)]);
  room.tick();
  assert.equal(lastSnap(a).ack, 8);
});

test('cmds from separate calls are consumed in arrival order', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  room.handleInput(a.p.id, [cmdf(1), cmdf(2)]);
  room.handleInput(a.p.id, [cmdf(3), cmdf(4), cmdf(5)]);
  room.tick();
  assert.equal(lastSnap(a).ack, 4);
});

test('empty cmds array is harmless', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  assert.doesNotThrow(() => room.handleInput(a.p.id, []));
  room.tick();
  assert.equal(lastSnap(a).ack, -1);
});

test('one players input queue does not affect another players', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  const b = join(room, 'b');
  room.handleInput(a.p.id, Array.from({ length: 20 }, (_, i) => cmdf(i + 1)));
  room.handleInput(b.p.id, [cmdf(1)]);
  room.tick();
  assert.equal(lastSnap(b).ack, 1);
});

test('cmds are applied before shots: a shot in the same tick uses the yaw from the cmd', { ...needOpen }, () => {
  const s = scene();
  s.S.p.yaw = s.line.d.yaw + Math.PI; // facing away
  s.room.handleInput(s.S.p.id, [cmdf(1, s.line.d.yaw)]);
  s.room.handleShoot(s.S.p.id);
  s.room.tick();
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
});

// ------------------------------------------------------------------ shooting
test('a level hit removes 37.5 hp (head, close band) from the victim', needOpen, () => {
  const s = scene();
  s.fire();
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
  assert.equal(WEAPON.damage, 25);
});

test('a hit sends {t:"hit", id: victimId} to the shooter only', needOpen, () => {
  const s = scene();
  s.fire();
  assert.deepEqual(s.S.of('hit'), [{ t: 'hit', id: s.V.p.id }]);
  assert.equal(s.V.of('hit').length, 0);
  assert.equal(s.C.of('hit').length, 0);
});

test('every player, including bystanders and the victim, receives the shot event', needOpen, () => {
  const s = scene();
  s.fire();
  for (const j of [s.S, s.V, s.C]) {
    assert.equal(j.of('shot').length, 1);
    assert.equal(j.of('shot')[0].id, s.S.p.id);
  }
});

test('shot.from is the eye position [x, y+1.6, z]', needOpen, () => {
  const s = scene();
  s.fire();
  const from = s.C.of('shot')[0].from;
  near(from[0], s.S.p.x);
  near(from[1], PLAYER.eye);
  near(from[2], s.S.p.z);
});

test('shot.from uses the shooters current height (airborne shooter)', needOpen, () => {
  const s = scene();
  s.S.p.y = 2;
  s.fire();
  near(s.C.of('shot')[0].from[1], 2 + PLAYER.eye);
});

test('shot.to on a player hit is the near face of the victim hitbox (distance 4 - 0.4)', needOpen, () => {
  const s = scene();
  s.fire();
  const { from, to } = s.C.of('shot')[0];
  near(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]), 4 - PLAYER.radius, 1e-6);
});

test('a shot at nothing reaches at least past where the victim stood and continues along the aim line', needOpen, () => {
  const s = scene();
  s.V.p.x = 1e4; // move victim far away, out of line
  s.V.p.z = 1e4;
  s.fire();
  const { from, to } = s.C.of('shot')[0];
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  assert.ok(len >= 10 - 1e-6, `len ${len}`);
  // travelled along the aim axis, staying on the perpendicular line
  const d = s.line.d;
  near((to[0] - from[0]) * d.dx + (to[2] - from[2]) * d.dz, len, 1e-6);
  assert.equal(s.V.p.hp, MAX_HP);
});

test('a shot into open sky travels exactly WEAPON.range', needOpen, (t) => {
  const s = scene();
  const dir = aimDir(s.line.d.yaw, 1.5);
  const probe = castRay([s.S.p.x, PLAYER.eye, s.S.p.z], dir, WEAPON.range, MAP.boxes, []);
  if (probe.t !== WEAPON.range) return t.skip('something is above the open line');
  s.V.p.x = 1e4;
  s.V.p.z = 1e4;
  s.S.p.pitch = 1.5;
  s.fire();
  const { from, to } = s.C.of('shot')[0];
  near(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]), WEAPON.range, 1e-6);
});

test('a player can never damage themself (shooting straight down)', needOpen, () => {
  const s = scene();
  s.V.p.x = 1e4;
  s.V.p.z = 1e4;
  s.S.p.pitch = -1.55;
  s.fire();
  assert.equal(s.S.p.hp, MAX_HP);
  assert.equal(s.S.p.deaths, 0);
  assert.equal(s.S.of('hit').length, 0);
});

test('a lone player shooting cannot hurt or score against themself', () => {
  const { room } = newRoom();
  const a = join(room, 'a');
  for (const pitch of [0, -1.5, 1.5]) {
    a.p.pitch = pitch;
    room.handleShoot(a.p.id);
    room.tick();
  }
  assert.equal(a.p.hp, MAX_HP);
  assert.equal(a.p.kills, 0);
  assert.equal(a.p.deaths, 0);
  assert.equal(a.of('hit').length, 0);
});

test('a wall between shooter and target prevents damage', needWall, () => {
  const { room } = newRoom();
  const S = join(room, 'S');
  const V = join(room, 'V');
  place(S.p, WALL.shooter, WALL.yaw);
  place(V.p, WALL.target, WALL.yaw + Math.PI);
  room.handleShoot(S.p.id);
  room.tick();
  assert.equal(V.p.hp, MAX_HP);
  assert.equal(S.of('hit').length, 0);
  assert.equal(S.of('shot').length, 1);
});

test('only the nearest player on the line is hit', needOpen, () => {
  const s = scene();
  const far = join(s.room, 'Far');
  place(far.p, s.at(8), s.line.d.yaw + Math.PI);
  s.fire();
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
  assert.equal(far.p.hp, MAX_HP);
});

test('a dead player cannot be hit; the bullet passes through the corpse to a live player behind', needOpen, () => {
  const s = scene();
  const far = join(s.room, 'Far');
  place(far.p, s.at(8), s.line.d.yaw + Math.PI);
  s.V.p.hp = WEAPON.damage;
  s.fire(); // kills V
  assert.equal(s.V.p.alive, false);
  s.clock.advance(WEAPON.cooldownMs);
  s.fire();
  assert.equal(s.V.p.deaths, 1);
  assert.equal(far.p.hp, MAX_HP - LEVEL_HIT);
});

test('three level head hits (100 hp) kill; two do not', needOpen, () => {
  const s = scene();
  for (let i = 1; i <= 2; i++) {
    s.fire();
    s.clock.advance(WEAPON.cooldownMs);
    assert.equal(s.V.p.alive, true, `after hit ${i}`);
    assert.equal(s.V.p.hp, MAX_HP - i * LEVEL_HIT);
  }
  s.fire();
  assert.equal(s.V.p.alive, false);
  assert.equal(s.V.p.hp, 0);
});

test('a kill updates kills/deaths and broadcasts the kill event to everyone', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  assert.equal(s.S.p.kills, 1);
  assert.equal(s.V.p.deaths, 1);
  assert.equal(s.S.p.deaths, 0);
  assert.equal(s.V.p.kills, 0);
  const expected = { t: 'kill', killer: s.S.p.id, victim: s.V.p.id, killerName: 'Shooter', victimName: 'Victim' };
  for (const j of [s.S, s.V, s.C]) assert.deepEqual(j.of('kill'), [expected]);
});

test('no kill event when the victim survives', needOpen, () => {
  const s = scene();
  s.fire();
  for (const j of [s.S, s.V, s.C]) assert.equal(j.of('kill').length, 0);
});

test('overkill never drives hp below 0 and the victim is marked dead', needOpen, () => {
  const s = scene();
  s.V.p.hp = 10;
  s.fire();
  assert.ok(s.V.p.hp >= 0, `hp=${s.V.p.hp}`);
  assert.equal(s.V.p.alive, false);
  assert.ok(entry(lastSnap(s.S), s.V.p.id).hp >= 0);
});

test('a dead victim appears in snapshots with alive=0', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  const e = entry(lastSnap(s.C), s.V.p.id);
  assert.strictEqual(e.alive, 0);
  assert.strictEqual(e.d, 1);
});

test('a dead shooter cannot shoot: the shot is discarded, no shot event, no damage', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire(); // V dies
  s.clock.advance(1); // still dead
  s.room.handleShoot(s.V.p.id); // dead victim faces the shooter
  s.room.tick();
  assert.equal(s.S.p.hp, MAX_HP);
  assert.ok(!s.C.of('shot').some((m) => m.id === s.V.p.id));
});

test('a dead player commands are consumed (ack advances, yaw copied) but not simulated', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  const { x, z } = s.V.p;
  s.room.handleInput(s.V.p.id, [cmdf(9, 2.5, { fwd: 1, right: 1, jump: true })]);
  s.room.tick();
  assert.equal(s.V.p.lastSeq, 9);
  assert.equal(s.V.p.yaw, 2.5);
  assert.equal(s.V.p.x, x);
  assert.equal(s.V.p.z, z);
});

test('at most one pending shot per player: three handleShoot calls fire once', needOpen, () => {
  const s = scene();
  s.room.handleShoot(s.S.p.id);
  s.room.handleShoot(s.S.p.id);
  s.room.handleShoot(s.S.p.id);
  s.room.tick();
  assert.equal(s.C.of('shot').length, 1);
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
});

test('a pending shot is cleared by the tick: the next tick does not fire again', needOpen, () => {
  const s = scene();
  s.fire();
  s.clock.advance(10 * WEAPON.cooldownMs);
  s.room.tick();
  assert.equal(s.C.of('shot').length, 1);
});

test('a shot discarded by cooldown is not retained for later ticks', needOpen, () => {
  const s = scene();
  s.fire();
  s.clock.advance(WEAPON.cooldownMs - 1);
  s.fire(); // discarded
  s.clock.advance(10 * WEAPON.cooldownMs);
  s.room.tick(); // no new handleShoot
  assert.equal(s.C.of('shot').length, 1);
});

test('the first shot is allowed even when the clock reads 0', needOpen, () => {
  const s = scene({ start: 0 });
  s.fire();
  assert.equal(s.C.of('shot').length, 1);
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
});

test('cooldown: a second shot exactly WEAPON.cooldownMs after the first is allowed', needOpen, () => {
  const s = scene();
  s.fire();
  s.clock.advance(WEAPON.cooldownMs);
  s.fire();
  assert.equal(s.C.of('shot').length, 2);
  assert.equal(s.V.p.hp, MAX_HP - 2 * LEVEL_HIT);
  assert.equal(WEAPON.cooldownMs, 150);
});

test('cooldown: a second shot cooldownMs-1 after the first is rejected', needOpen, () => {
  const s = scene();
  s.fire();
  s.clock.advance(WEAPON.cooldownMs - 1);
  s.fire();
  assert.equal(s.C.of('shot').length, 1);
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
});

test('cooldown is per shooter: the shooters cooldown does not block another players first shot', needOpen, () => {
  const s = scene();
  place(s.C.p, { x: 1e3, z: 1e3 }, 0); // bystander far away
  s.fire();
  s.room.handleShoot(s.V.p.id); // V shoots back at S, first shot ever
  s.room.tick();
  assert.equal(s.S.p.hp, MAX_HP - LEVEL_HIT);
});

test('the respawn happens at exactly RESPAWN_MS after death, not one ms earlier', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  const died = s.clock.t;
  s.clock.t = died + RESPAWN_MS - 1;
  s.room.tick();
  assert.equal(s.V.p.alive, false);
  assert.equal(RESPAWN_MS, 3000);
  s.clock.t = died + RESPAWN_MS;
  s.room.tick();
  assert.equal(s.V.p.alive, true);
});

test('a respawned player has full hp, zero velocity, y=0 and stands on the spawn farthest from the living', needOpen, () => {
  const n = MAP.spawns.length;
  const s = scene({ random: () => (n - 0.5) / n });
  s.V.p.hp = WEAPON.damage;
  s.V.p.vx = 3;
  s.V.p.vy = 4;
  s.V.p.vz = 5;
  s.fire();
  s.clock.advance(RESPAWN_MS);
  s.room.tick();
  // SPEC 21.2: with living enemies the spawn whose nearest enemy is farthest wins (ties by random).
  const others = [s.S.p, s.C.p];
  const nearest = (sp) => Math.min(...others.map((q) => Math.hypot(sp.x - q.x, sp.z - q.z)));
  const best = Math.max(...MAP.spawns.map(nearest));
  const spawn = MAP.spawns.find((sp) => sp.x === s.V.p.x && sp.z === s.V.p.z);
  assert.ok(spawn, 'stands on a spawn point');
  assert.ok(Math.abs(nearest(spawn) - best) < 1e-9, 'the safest one');
  assert.equal(s.V.p.alive, true);
  assert.equal(s.V.p.hp, MAX_HP);
  assert.deepEqual([s.V.p.vx, s.V.p.vy, s.V.p.vz].map((v) => v === 0), [true, true, true]);
  assert.ok(s.V.p.y === 0);
});

test('respawn keeps kills and deaths', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  s.clock.advance(RESPAWN_MS);
  s.room.tick();
  assert.equal(s.V.p.deaths, 1);
  assert.equal(s.S.p.kills, 1);
});

test('the snapshot of the respawn tick already shows the player alive with full hp', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  s.clock.advance(RESPAWN_MS);
  s.room.tick();
  const e = entry(lastSnap(s.C), s.V.p.id);
  assert.strictEqual(e.alive, 1);
  assert.equal(e.hp, MAX_HP);
});

test('a respawned player is protected for SPAWN.protectMs, then can be hit again', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  s.clock.advance(RESPAWN_MS);
  s.room.tick();
  place(s.V.p, s.at(4), s.line.d.yaw + Math.PI);
  s.clock.advance(WEAPON.cooldownMs);
  s.fire();
  assert.equal(s.V.p.hp, MAX_HP, 'SPEC 21.2: no damage while protected');
  assert.equal(s.S.inbox.filter((m) => m.t === 'verdict').at(-1).dmg, 0, 'the verdict reports 0');
  s.clock.advance(SPAWN.protectMs);
  s.fire();
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
});

test('a protected player who shoots loses the protection at once', needOpen, () => {
  const s = scene();
  s.V.p.hp = WEAPON.damage;
  s.fire();
  s.clock.advance(RESPAWN_MS);
  s.room.tick();
  place(s.V.p, s.at(4), s.line.d.yaw + Math.PI);
  s.room.handleShoot(s.V.p.id);
  s.room.tick();
  s.clock.advance(WEAPON.cooldownMs);
  s.fire();
  assert.equal(s.V.p.hp, MAX_HP - LEVEL_HIT);
});

test('events precede the snapshot within a tick', needOpen, () => {
  const s = scene();
  s.fire();
  const shotIdx = s.C.inbox.findIndex((m) => m.t === 'shot');
  const snapIdx = s.C.inbox.findIndex((m) => m.t === 'snap');
  assert.ok(shotIdx >= 0 && snapIdx > shotIdx, `shot@${shotIdx} snap@${snapIdx}`);
});

// ------------------------------------------------------------------ property-style
test('property: invariants hold after arbitrary seeded sequences of API calls', () => {
  let totalShots = 0;
  for (const seed of [1, 2, 3, 4]) {
    const rnd = mulberry32(seed * 104729);
    const clock = { t: 5000 };
    const room = new GameRoom({ now: () => clock.t, random: rnd, maxPlayers: 6 });
    const live = new Map(); // id -> {p, inbox, seq}
    const seen = new Set();
    const prev = new Map(); // id -> {kills, deaths}

    for (let step = 0; step < 700; step++) {
      const r = rnd();
      const ids = [...live.keys()];
      if (r < 0.05 && live.size < 6) {
        const inbox = [];
        const p = room.addPlayer({ send: (m) => inbox.push(m), name: rnd() < 0.3 ? '<x>' : `n${step}` });
        if (p) {
          assert.ok(!seen.has(p.id), 'id reused');
          seen.add(p.id);
          live.set(p.id, { p, inbox, seq: 0 });
        }
      } else if (r < 0.07 && ids.length) {
        const id = ids[Math.floor(rnd() * ids.length)];
        assert.equal(room.removePlayer(id), true);
        live.delete(id);
        prev.delete(id);
      } else if (r < 0.45 && ids.length) {
        const e = live.get(ids[Math.floor(rnd() * ids.length)]);
        const n = 1 + Math.floor(rnd() * 8);
        const cmds = [];
        for (let k = 0; k < n; k++) {
          e.seq += rnd() < 0.1 ? 0 : 1; // sometimes replay a seq
          cmds.push(cmdf(e.seq, (rnd() * 2 - 1) * 12, { fwd: rnd() * 2 - 1, right: rnd() * 2 - 1, jump: rnd() < 0.2, pitch: (rnd() * 2 - 1) * 1.5 }));
        }
        room.handleInput(e.p.id, cmds);
      } else if (r < 0.65 && ids.length) {
        const e = live.get(ids[Math.floor(rnd() * ids.length)]);
        const others = ids.filter((i) => i !== e.p.id);
        if (others.length) {
          const o = live.get(others[Math.floor(rnd() * others.length)]).p;
          e.p.yaw = Math.atan2(-(o.x - e.p.x), -(o.z - e.p.z));
          e.p.pitch = 0;
        }
        if (rnd() < 0.2 && e.p.alive) e.p.hp = WEAPON.damage;
        room.handleShoot(e.p.id);
      } else {
        clock.t += Math.floor(rnd() * 400);
        room.tick();
        const seenIds = new Set();
        for (const { p } of live.values()) {
          assert.ok(!seenIds.has(p.id), 'duplicate id');
          seenIds.add(p.id);
          const where = `seed ${seed} step ${step} player ${p.id}`;
          assert.ok(p.hp >= 0 && p.hp <= MAX_HP, `${where} hp=${p.hp}`);
          assert.equal(p.alive, p.hp > 0, `${where} alive/hp mismatch`);
          const before = prev.get(p.id) ?? { kills: 0, deaths: 0 };
          assert.ok(p.kills >= before.kills, `${where} kills decreased`);
          assert.ok(p.deaths >= before.deaths, `${where} deaths decreased`);
          prev.set(p.id, { kills: p.kills, deaths: p.deaths });
          if (p.alive) {
            assert.ok(Math.abs(p.x) <= MAP.half - PLAYER.radius + 1e-9, `${where} x=${p.x}`);
            assert.ok(Math.abs(p.z) <= MAP.half - PLAYER.radius + 1e-9, `${where} z=${p.z}`);
            assert.ok(p.y >= 0, `${where} y=${p.y}`);
            const eps = 1e-9;
            const inBox = MAP.boxes.some(
              (b) =>
                p.x - PLAYER.radius < b.max[0] - eps && p.x + PLAYER.radius > b.min[0] + eps &&
                p.y < b.max[1] - eps && p.y + PLAYER.height > b.min[1] + eps &&
                p.z - PLAYER.radius < b.max[2] - eps && p.z + PLAYER.radius > b.min[2] + eps,
            );
            assert.equal(inBox, false, `${where} overlaps a box`);
          }
        }
        assert.equal(room.playerCount, live.size);
      }
    }
    for (const { inbox } of live.values()) totalShots += inbox.filter((m) => m.t === 'shot').length;
  }
  assert.ok(totalShots > 0, 'property run never produced a shot; test would be vacuous');
});
