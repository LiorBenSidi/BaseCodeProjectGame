import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATION_LEVELS, STATION_GAP_MS, STATION_MAX_ROUNDS, nextLevel, newStation, pickTargetSpot, stepStation, recordHit, stationSummary, isStationLevel } from '../../src/shared/rangeStation.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { validateClientMessage as validateMessage } from '../../src/server/protocol.js';
import { stationText } from '../../src/client/hud.js';

test('SPEC 37.7: levels, cycling and validation', () => {
  assert.deepEqual(Object.keys(STATION_LEVELS), ['easy', 'medium', 'hard']);
  assert.equal(STATION_LEVELS.hard.windowMs, 900);
  assert.equal(nextLevel(null), 'easy');
  assert.equal(nextLevel('easy'), 'medium');
  assert.equal(nextLevel('medium'), 'hard');
  assert.equal(nextLevel('hard'), null);
  assert.equal(isStationLevel('hard'), true);
  assert.equal(isStationLevel('insane'), false);
});

test('SPEC 37.7: the station clock shows, times out, records hits and ends after the round cap', () => {
  const st = newStation(1, 'medium', 1000);
  assert.equal(stepStation(st, 1000), null);
  assert.deepEqual(stepStation(st, 1000 + STATION_GAP_MS), { show: true });
  st.targetId = 9; st.shownAt = 1500;
  assert.equal(stepStation(st, 1500 + 1499), null);
  assert.deepEqual(stepStation(st, 1500 + 1500), { miss: true });
  assert.equal(st.misses, 1); assert.equal(st.targetId, null);
  st.targetId = 9; st.shownAt = 4000;
  assert.equal(recordHit(st, 4412), 412);
  const sum = stationSummary(st);
  assert.deepEqual([sum.hits, sum.misses, sum.rounds, sum.avgMs, sum.bestMs, sum.lastMs], [1, 1, 2, 412, 412, 412]);
  st.rounds = STATION_MAX_ROUNDS;
  assert.deepEqual(stepStation(st, 99_999), { done: true });
});

test('SPEC 37.7: the target spot sits in the level band when one exists, never under the owner', () => {
  const spawns = [{ x: 0, z: 1 }, { x: 10, z: 0 }, { x: 30, z: 0 }, { x: 60, z: 0 }];
  const owner = { x: 0, z: 0 };
  assert.deepEqual(pickTargetSpot(spawns, owner, 'easy', () => 0), { x: 10, z: 0 }); // 8..22 m band
  assert.deepEqual(pickTargetSpot(spawns, owner, 'hard', () => 0.99), { x: 30, z: 0 }); // 12..34 m band
  assert.deepEqual(pickTargetSpot([{ x: 0, z: 1 }, { x: 100, z: 0 }], owner, 'easy', () => 0), { x: 100, z: 0 }); // fallback: any spot off the owner
  assert.equal(pickTargetSpot([{ x: 0, z: 1 }], owner, 'easy'), null);
});

test('SPEC 37.7: protocol accepts a level or null and rejects junk', () => {
  assert.equal(validateMessage({ t: 'station', level: 'hard' }).ok, true);
  assert.equal(validateMessage({ t: 'station', level: null }).ok, true);
  assert.equal(validateMessage({ t: 'station', level: 5 }).ok, false);
  assert.equal(validateMessage({ t: 'station' }).ok, false);
});

test('SPEC 37.7: in the range a dummy pops up frozen in the band, a hit by the owner closes the round, a timeout is a miss', () => {
  let now = 50_000;
  const room = new GameRoom({ now: () => now, random: () => 0.5, mode: 'range', botFill: 2, botDifficulty: 'dummy', botSeed: 1 });
  const inbox = [];
  const me = room.addPlayer({ send: (m) => inbox.push(m), name: 'Me' });
  const station = () => inbox.filter((m) => m.t === 'station');
  assert.equal(room.handleStation(me.id, 'hard'), true);
  assert.equal(station().at(-1).on, 1);
  now += STATION_GAP_MS; room.tick();
  const shown = station().at(-1);
  assert.equal(typeof shown.target, 'number');
  const snapOf = (id) => inbox.filter((m) => m.t === 'snap').at(-1).players.find((p) => p.id === id);
  const bot = snapOf(shown.target);
  const d = Math.hypot(bot.x - me.x, bot.z - me.z);
  assert.ok(d >= 2, `target is away from the owner (${d.toFixed(1)} m)`);
  assert.equal(bot.alive, 1);
  for (let i = 0; i < 10; i++) { now += 33; room.tick(); }
  const later = snapOf(shown.target);
  assert.deepEqual({ x: later.x, z: later.z }, { x: bot.x, z: bot.z }, 'a frozen target does not walk');
  // timeout after 900 ms is a miss
  now += 900; room.tick();
  assert.equal(station().at(-1).miss, 1);
  // next target, then the owner lands a shot: aim straight at it
  now += STATION_GAP_MS; room.tick();
  const t2 = station().at(-1);
  assert.equal(typeof t2.target, 'number');
  const target = snapOf(t2.target);
  const dx = target.x - me.x, dz = target.z - me.z;
  me.yaw = Math.atan2(-dx, -dz); me.pitch = 0;
  now += 120;
  room.handleInput(me.id, [{ seq: 1, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tac: false, yaw: me.yaw, pitch: 0 }]);
  room.handleShoot(me.id);
  room.tick();
  const hit = station().at(-1);
  assert.equal(hit.hit, 1, `expected a hit message, got ${JSON.stringify(hit)}`);
  assert.ok(hit.ms >= 100 && hit.ms <= 200, `reaction ${hit.ms} ms`);
  // off
  assert.equal(room.handleStation(me.id, null), true);
  assert.equal(station().at(-1).on, 0);
});

test('SPEC 37.7: the station is refused outside the range', () => {
  const room = new GameRoom({ now: () => 1000, random: () => 0.5, mode: 'dm' });
  const p = room.addPlayer({ send: () => {}, name: 'A' });
  assert.equal(room.handleStation(p.id, 'easy'), false);
});

test('SPEC 37.7: the HUD line reads cleanly in every state', () => {
  const base = { level: 'hard', hits: 1, misses: 2, rounds: 3, avgMs: 400, bestMs: 400, lastMs: 400 };
  assert.equal(stationText({ on: 1, target: 4, ...base }), 'TARGET UP (hard)  1 hit / 2 misses, last 400 ms, avg 400 ms, best 400 ms');
  assert.equal(stationText({ on: 1, hit: 1, ms: 400, ...base }), 'HIT 400 ms (hard)  1 hit / 2 misses, last 400 ms, avg 400 ms, best 400 ms');
  assert.equal(stationText({ on: 1, level: 'easy', hits: 0, misses: 0, rounds: 0, avgMs: null, bestMs: null, lastMs: null }), 'Reaction (easy) armed: 0 hits / 0 misses  [T cycles level]');
  assert.equal(stationText({ on: 0, ...base }), 'Reaction (hard) over: 1 hit / 2 misses, last 400 ms, avg 400 ms, best 400 ms');
});
