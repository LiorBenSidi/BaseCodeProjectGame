// SPEC 22 at room level: match start, timer, score limit, end screen, restart, TDM teams and friendly fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MODES, ENDING_MS } from '../../src/shared/modes.js';
import { RESPAWN_MS } from '../../src/shared/constants.js';

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, ...opts });
  return { room, clock, advance: (ms) => { clock.t += ms; } };
}
function join(room, name, x, z, yaw = 0) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  Object.assign(p, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0 });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}
const shoot = (room, j) => { room.handleShoot(j.p.id); room.tick(); };

test('an unknown mode is refused at construction', () => {
  assert.throws(() => new GameRoom({ mode: 'ctf' }), RangeError);
  assert.equal(new GameRoom().mode, 'dm');
});

test('the first join starts the match; welcome carries mode and team; the snapshot carries the match', () => {
  const { room } = newRoom();
  assert.equal(room.matchState.phase, 'waiting');
  const a = join(room, 'A', 30, 30);
  assert.equal(a.of('welcome')[0].mode, 'dm');
  assert.equal(a.of('welcome')[0].team, -1);
  assert.equal(a.of('matchStart').length, 1);
  assert.equal(a.of('matchStart')[0].number, 1);
  room.tick();
  assert.deepEqual(a.lastSnap().match, { mode: 'dm', phase: 'playing', left: 300, ts: null });
  assert.equal(a.lastSnap().players[0].tm, -1);
  const b = join(room, 'B', -30, -30);
  assert.equal(b.of('matchStart').length, 0, 'a later join does not restart');
  room.removePlayer(a.p.id);
  room.removePlayer(b.p.id);
  assert.equal(room.matchState.phase, 'waiting', 'an empty room waits');
});

test('DM: time runs out, matchEnd names the leader, nobody can shoot, then the match restarts clean', () => {
  const { room, advance } = newRoom();
  const a = join(room, 'A', 30, 30);
  const b = join(room, 'B', 30, 26);
  a.p.kills = 7; b.p.kills = 2; b.p.deaths = 7;
  advance(MODES.dm.timeLimitMs);
  room.tick();
  const [end] = a.of('matchEnd');
  assert.equal(end.reason, 'time');
  assert.deepEqual(end.winner, { type: 'player', id: a.p.id, name: 'A' });
  assert.deepEqual(end.ranking.map((r) => r.id), [a.p.id, b.p.id]);
  assert.equal(b.of('matchEnd').length, 1);
  assert.equal(a.lastSnap().match.phase, 'ending');
  shoot(room, a);
  assert.equal(a.of('shot').length, 0, 'no shooting on the end screen');
  room.handleThrow(a.p.id); room.tick();
  assert.equal(a.lastSnap().nades.length, 0, 'no grenades either');
  advance(ENDING_MS); room.tick();
  assert.equal(a.of('matchStart').length, 2);
  assert.equal(a.of('matchStart')[1].number, 2);
  assert.equal(a.p.kills, 0);
  assert.equal(b.p.deaths, 0);
  assert.equal(b.p.alive, true);
  assert.equal(a.lastSnap().match.phase, 'playing');
  assert.equal(a.of('matchEnd').length, 1, 'ended once');
});

test('DM: reaching the score limit ends the match on that tick', () => {
  const { room, advance } = newRoom();
  const a = join(room, 'A', 30, 30);
  const b = join(room, 'B', 30, 26);
  a.p.kills = MODES.dm.scoreLimit - 1;
  b.p.hp = 10;
  shoot(room, a);
  assert.equal(a.p.kills, MODES.dm.scoreLimit);
  assert.equal(a.of('matchEnd')[0].reason, 'score');
  advance(RESPAWN_MS); room.tick();
  assert.equal(b.p.alive, true, 'respawns still happen on the end screen');
});

test('TDM: teams alternate, friendly fire does nothing, team scores move and the limit ends the match', () => {
  const { room, advance } = newRoom({ mode: 'tdm' });
  const a = join(room, 'A', 30, 30);
  const b = join(room, 'B', 30, 26);
  const c = join(room, 'C', 30, 22);
  assert.deepEqual([a.p.team, b.p.team, c.p.team], [0, 1, 0]);
  room.tick();
  assert.deepEqual(a.lastSnap().players.map((p) => p.tm), [0, 1, 0]);
  assert.deepEqual(a.lastSnap().match.ts, [0, 0]);
  // A (Blue) shoots B (Red) in the head at 3.6 m: 37.5
  shoot(room, a);
  assert.equal(b.p.hp, 62.5);
  // B dead? no. Move B out of the way and have A shoot teammate C.
  b.p.x = -30;
  advance(150);
  shoot(room, a);
  assert.equal(c.p.hp, 100, 'no friendly fire');
  assert.equal(a.of('verdict').at(-1).dmg, 0);
  b.p.x = 30; b.p.hp = 10;
  advance(150);
  shoot(room, a);
  assert.equal(b.p.alive, false);
  assert.deepEqual(a.lastSnap().match.ts, [1, 0]);
  const m = room.matchState;
  assert.equal(m.phase, 'playing');
});

test('TDM: the team at the score limit wins', () => {
  const { room, advance } = newRoom({ mode: 'tdm' });
  const a = join(room, 'A', 30, 30);
  const b = join(room, 'B', 30, 26);
  for (let i = 0; i < MODES.tdm.scoreLimit; i++) {
    b.p.hp = 10; b.p.alive = true; b.p.x = 30; b.p.z = 26;
    a.p.loadout.primary.mag = 30; // no reload stops in this loop
    advance(150);
    shoot(room, a);
  }
  const ends = a.of('matchEnd');
  assert.equal(ends.length, 1);
  assert.deepEqual(ends[0].winner, { type: 'team', team: 0, name: 'Blue' });
  assert.deepEqual(ends[0].teamScores, [MODES.tdm.scoreLimit, 0]);
});
