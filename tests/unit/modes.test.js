// SPEC 22: match modes and the match state machine (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, newMatch, startMatch, assignTeam, scoreKill, endReason, endMatch, shouldRestart, matchSnapshot, ENDING_MS, modeDef, ranking } from '../../src/shared/modes.js';

const pl = (id, kills = 0, deaths = 0, team = -1) => ({ id, name: `P${id}`, kills, deaths, team });

test('modes: deathmatch and team deathmatch with time and score limits', () => {
  assert.deepEqual(Object.keys(MODES), ['dm', 'tdm']);
  assert.equal(MODES.dm.teams, false);
  assert.equal(MODES.tdm.teams, true);
  assert.throws(() => modeDef('ctf'), RangeError);
});

test('a new match waits; start sets the timer; snapshot shows seconds left', () => {
  const m = newMatch('dm');
  assert.equal(m.phase, 'waiting');
  startMatch(m, 10_000);
  assert.equal(m.phase, 'playing');
  assert.equal(m.endsAt, 10_000 + MODES.dm.timeLimitMs);
  assert.equal(m.number, 1);
  assert.deepEqual(matchSnapshot(m, 10_000), { mode: 'dm', phase: 'playing', left: 300, ts: null });
  assert.equal(matchSnapshot(m, 10_000 + 1400).left, 299);
});

test('team assignment fills the smaller team, ties to Blue; DM has no teams', () => {
  const t = newMatch('tdm');
  const players = [];
  for (let i = 0; i < 5; i++) players.push({ team: assignTeam(t, players) });
  assert.deepEqual(players.map((p) => p.team), [0, 1, 0, 1, 0]);
  assert.equal(assignTeam(newMatch('dm'), players), -1);
});

test('DM ends on time or when a player reaches the score limit; the top player wins, equal tops draw', () => {
  const m = newMatch('dm');
  startMatch(m, 0);
  const a = pl(1, 25, 3);
  const b = pl(2, 10, 5);
  assert.equal(endReason(m, [pl(1, 24)], 0), null);
  assert.equal(endReason(m, [a, b], 0), 'score');
  assert.equal(endReason(m, [pl(1)], MODES.dm.timeLimitMs), 'time');
  const r = endMatch(m, [b, a], 1000, 'score');
  assert.equal(m.phase, 'ending');
  assert.deepEqual(r.winner, { type: 'player', id: 1, name: 'P1' });
  assert.deepEqual(r.ranking.map((x) => x.id), [1, 2]);
  assert.deepEqual(endMatch(newMatch('dm'), [pl(1, 5, 1), pl(2, 5, 1)], 0, 'time').winner, { type: 'draw' });
  assert.deepEqual(endMatch(newMatch('dm'), [], 0, 'time').winner, { type: 'draw' });
  assert.equal(endReason(m, [a], 5000), null, 'an ending match does not end twice');
});

test('TDM scores per team, teammate kills cost a point, the team at the limit wins', () => {
  const m = newMatch('tdm');
  startMatch(m, 0);
  const blue = pl(1, 0, 0, 0);
  const blue2 = pl(3, 0, 0, 0);
  const red = pl(2, 0, 0, 1);
  scoreKill(m, blue, red);
  scoreKill(m, blue, red);
  scoreKill(m, red, blue);
  scoreKill(m, blue, blue2);
  scoreKill(m, blue, blue);
  scoreKill(m, null, blue);
  assert.deepEqual(m.teamScores, [1, 1]);
  m.teamScores = [50, 12];
  assert.equal(endReason(m, [blue, red], 0), 'score');
  const r = endMatch(m, [blue, red], 0, 'score');
  assert.deepEqual(r.winner, { type: 'team', team: 0, name: 'Blue' });
  assert.deepEqual(r.teamScores, [50, 12]);
  assert.equal(matchSnapshot(m, 0).ts.length, 2);
  const d = newMatch('tdm'); startMatch(d, 0); d.teamScores = [3, 3];
  assert.deepEqual(endMatch(d, [], 0, 'time').winner, { type: 'draw' });
});

test('the end screen lasts ENDING_MS, then the match restarts with fresh scores and a new number', () => {
  const m = newMatch('tdm');
  startMatch(m, 0);
  m.teamScores = [5, 1];
  endMatch(m, [], 100, 'time');
  assert.equal(shouldRestart(m, 100 + ENDING_MS - 1), false);
  assert.equal(shouldRestart(m, 100 + ENDING_MS), true);
  startMatch(m, 100 + ENDING_MS);
  assert.deepEqual(m.teamScores, [0, 0]);
  assert.equal(m.number, 2);
});

test('ranking is kills desc, deaths asc, id asc', () => {
  assert.deepEqual(ranking([pl(3, 2, 0), pl(1, 2, 0), pl(2, 5, 9), pl(4, 2, 1)]).map((x) => x.id), [2, 1, 3, 4]);
});
