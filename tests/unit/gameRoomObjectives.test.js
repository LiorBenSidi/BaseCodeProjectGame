// SPEC 39 at room level: KOTH hill scoring and CTF captures through GameRoom, snapshot shape, flag events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MODES } from '../../src/shared/modes.js';
import { HILL_RADIUS } from '../../src/shared/objectives.js';

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, botFill: 0, ...opts });
  return { room, clock, advance: (ms) => { clock.t += ms; } };
}
function join(room, name) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}
const put = (j, x, z) => Object.assign(j.p, { x, y: 0, z, vx: 0, vy: 0, vz: 0 });
const ticks = (room, advance, n) => { for (let i = 0; i < n; i += 1) { advance(1000 / 30); room.tick(); } };

test('KOTH: the snapshot carries the hill, a lone holder scores a point a second, contested scores nothing', () => {
  const { room, advance } = newRoom({ mode: 'koth' });
  const a = join(room, 'A'), b = join(room, 'B');
  assert.notEqual(a.p.team, b.p.team, 'two joins land on opposite teams');
  room.tick();
  const obj = a.lastSnap().match.obj;
  assert.equal(obj.kind, 'hill');
  assert.equal(obj.r, HILL_RADIUS);
  assert.equal(obj.holder, -1);
  put(a, obj.x, obj.z); put(b, obj.x + 30, obj.z);
  ticks(room, advance, 90); // 3 s
  const ts = a.lastSnap().match.ts;
  assert.equal(ts[a.p.team], 3);
  assert.equal(ts[b.p.team], 0);
  assert.equal(a.lastSnap().match.obj.holder, a.p.team);
  put(b, obj.x, obj.z);
  ticks(room, advance, 60);
  assert.equal(a.lastSnap().match.obj.contested, true);
  assert.deepEqual(a.lastSnap().match.ts, ts, 'contested: nobody scored');
  // a kill does not score in KOTH
  room.removePlayer(a.p.id); room.removePlayer(b.p.id);
});

test('CTF: take, carry home and capture; the carrier is flagged in the snapshot; events are broadcast with text', () => {
  const { room, advance } = newRoom({ mode: 'ctf' });
  const a = join(room, 'A'), b = join(room, 'B');
  room.tick();
  const obj = a.lastSnap().match.obj;
  assert.equal(obj.kind, 'flags');
  assert.equal(obj.bases.length, 2);
  const my = a.p.team, enemy = 1 - my;
  put(b, 0, 0);
  put(a, obj.bases[enemy].x, obj.bases[enemy].z);
  ticks(room, advance, 2);
  assert.equal(a.lastSnap().players.find((p) => p.id === a.p.id).fl, 1, 'carrier flagged');
  assert.equal(a.lastSnap().match.obj.flags[enemy].carrier, a.p.id);
  assert.equal(a.of('flag')[0].type, 'take');
  assert.match(a.of('flag')[0].text, /took the (Blue|Red) flag/);
  put(a, obj.bases[my].x, obj.bases[my].z);
  ticks(room, advance, 2);
  assert.equal(a.lastSnap().match.ts[my], 1);
  assert.equal(a.of('flag').at(-1).type, 'capture');
  assert.equal(b.of('flag').at(-1).type, 'capture', 'both teams hear it');
  assert.equal(MODES.ctf.scoreLimit, 3);
  room.removePlayer(a.p.id); room.removePlayer(b.p.id);
});
