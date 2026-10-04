// SPEC 27: results, stats deltas, merge and leaderboard (pure) plus the room hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchResultRecord, statsDeltas, mergeStats, leaderboard, playerWon } from '../../src/shared/persistence.js';
import { GameRoom } from '../../src/server/GameRoom.js';

const result = { reason: 'score', number: 3, winner: { type: 'player', id: 1, name: 'A' }, teamScores: [0, 0], ranking: [] };
const players = [
  { id: 1, name: 'A', userId: 'u1', kills: 25, deaths: 4, team: -1, progress: { xp: 2600, level: 5 } },
  { id: 2, name: 'B', userId: null, kills: 4, deaths: 25, team: -1, progress: { xp: 410, level: 3 } },
];

test('matchResultRecord carries the canonical result and every player line', () => {
  const r = matchResultRecord({ roomId: 'dm-abcdef', mode: 'dm', result, players, nowMs: 1_700_000_000_000 });
  assert.equal(r.match_number, 3);
  assert.deepEqual(r.winner, { type: 'player', name: 'A' });
  assert.deepEqual(r.players[1], { name: 'B', user_id: null, kills: 4, deaths: 25, team: -1, xp: 410, level: 3 });
  assert.equal(r.ended_at, '2023-11-14T22:13:20.000Z');
});

test('statsDeltas skips anonymous players and marks wins by id (DM) or team (TDM)', () => {
  const d = statsDeltas({ result, players, nowMs: 0 });
  assert.equal(d.length, 1);
  assert.equal(d[0].user_id, 'u1');
  assert.equal(d[0].wins, 1);
  assert.equal(d[0].best_kills, 25);
  const tdm = { ...result, winner: { type: 'team', team: 1, name: 'Red' } };
  assert.equal(playerWon(tdm, { id: 9, team: 1 }), true);
  assert.equal(playerWon(tdm, { id: 9, team: 0 }), false);
  assert.equal(playerWon({ winner: { type: 'draw' } }, { id: 1 }), false);
});

test('mergeStats adds totals, keeps the best match and the latest name', () => {
  const d = statsDeltas({ result, players, nowMs: 5000 })[0];
  const fresh = mergeStats(undefined, d);
  assert.equal(fresh.kills, 25);
  assert.equal(fresh.matches, 1);
  const again = mergeStats({ ...fresh, name: 'Old', best_kills: 30 }, { ...d, kills: 3, wins: 0, name: 'New' });
  assert.equal(again.kills, 28);
  assert.equal(again.matches, 2);
  assert.equal(again.wins, 1);
  assert.equal(again.best_kills, 30);
  assert.equal(again.name, 'New');
});

test('leaderboard ranks by kills, wins, then fewer deaths', () => {
  const lb = leaderboard([
    { user_id: 'a', name: 'A', kills: 10, deaths: 5, wins: 1 },
    { user_id: 'b', name: 'B', kills: 10, deaths: 2, wins: 1 },
    { user_id: 'c', name: 'C', kills: 12, deaths: 9, wins: 0 },
    { bogus: true },
  ], 2);
  assert.deepEqual(lb.map((r) => [r.rank, r.name]), [[1, 'C'], [2, 'B']]);
  assert.equal(lb[1].kd, 5);
});

test('room hooks: roster fires on join, leave and match start; matchEnd carries the result and the roster', () => {
  const calls = [];
  let t = 1000;
  const room = new GameRoom({ now: () => t, random: () => 0, hooks: { roster: (i) => calls.push(['roster', i.players, i.phase]), matchEnd: (i) => calls.push(['end', i.result.reason, i.players.length]) } });
  const a = room.addPlayer({ name: 'A', send: () => {}, userId: 'u1' });
  const b = room.addPlayer({ name: 'B', send: () => {}, userId: { not: 'a string' } });
  assert.equal(a.userId, 'u1');
  assert.equal(b.userId, null);
  room.tick();
  assert.equal(calls[0][0], 'roster');
  assert.equal(calls[0][1], 1);
  assert.ok(calls.some((c) => c[0] === 'roster' && c[1] === 2 && c[2] === 'playing'), 'the second join is seen in a playing match');
  t += 300_001; room.tick(); // DM time limit
  const end = calls.find((c) => c[0] === 'end');
  assert.deepEqual(end, ['end', 'time', 2]);
  room.removePlayer(a.id);
  assert.deepEqual(calls.at(-1), ['roster', 1, 'ending']);
  // a throwing hook never breaks the room
  const bad = new GameRoom({ now: () => 0, hooks: { roster: () => { throw new Error('x'); } } });
  assert.ok(bad.addPlayer({ name: 'Z', send: () => {} }));
});
