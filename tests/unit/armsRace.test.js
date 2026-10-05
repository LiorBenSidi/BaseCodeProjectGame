// SPEC 40.3: the Arms Race ladder (pure) and its match-model hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, ARMS_KILLS_PER_STAGE, FINAL_STAGE, newArms, armsKill, armsLoadoutIds, armsLeader, armsLine, stageText, ownStageBanner, ENEMY_STAGE_BANNER } from '../../src/shared/armsRace.js';
import { WEAPON_IDS } from '../../src/shared/weapons.js';
import { MODES, newMatch, startMatch, endReason, endMatch, matchSnapshot, scoreKill, botConfigFor } from '../../src/shared/modes.js';

test('eight stages, every one a real weapon, pistol first and revolver last', () => {
  assert.equal(STAGES.length, 8);
  for (const w of STAGES) assert.ok(WEAPON_IDS.includes(w), w);
  assert.equal(new Set(STAGES).size, 8);
  assert.equal(STAGES[0], 'pistol');
  assert.equal(STAGES[FINAL_STAGE], 'revolver');
});

test('three kills advance a stage, the ladder is per team, the final stage wins', () => {
  const a = newArms();
  assert.deepEqual(armsLoadoutIds(a, 0), { primary: 'pistol', sidearm: 'pistol' });
  let r;
  for (let i = 0; i < ARMS_KILLS_PER_STAGE - 1; i++) { r = armsKill(a, 0); assert.equal(r.advanced, false); }
  r = armsKill(a, 0);
  assert.deepEqual(r, { advanced: true, won: false, stage: 1, progress: 0, weapon: 'smg' });
  assert.deepEqual(a.stages, [1, 0]);
  assert.deepEqual(armsLoadoutIds(a, 0), { primary: 'smg', sidearm: 'smg' });
  assert.deepEqual(armsLoadoutIds(a, 1), { primary: 'pistol', sidearm: 'pistol' });
  for (let i = 0; i < 20; i++) r = armsKill(a, 0);
  assert.equal(a.stages[0], FINAL_STAGE);
  assert.equal(a.progress[0], 2);
  assert.equal(a.won, -1);
  r = armsKill(a, 0);
  assert.equal(r.won, true);
  assert.equal(a.won, 0);
  assert.deepEqual(armsKill(a, 1), { advanced: false, won: false, stage: 0, progress: 0 }, 'kills after the win change nothing');
  assert.equal(armsKill(newArms(), 7).advanced, false, 'an unknown team is ignored');
});

test('leader on time: stage, then kills on the stage, then total kills, else a draw', () => {
  const a = newArms();
  assert.equal(armsLeader(a), -1);
  armsKill(a, 1);
  assert.equal(armsLeader(a), 1);
  armsKill(a, 0); armsKill(a, 0); armsKill(a, 0); // blue reaches stage 1
  assert.equal(armsLeader(a), 0);
  assert.equal(armsLeader(newArms(), [5, 9]), 1);
  const w = newArms(); w.won = 1; w.stages = [7, 3];
  assert.equal(armsLeader(w), 1, 'a finished ladder beats every tiebreak');
});

test('texts: HUD line from my team, team feed line, banners', () => {
  const a = newArms();
  for (let i = 0; i < 7; i++) armsKill(a, 1);
  assert.equal(armsLine(a, 1), 'STAGE 3/8  SHOTGUN  1/3   enemy 1/8');
  assert.equal(armsLine(a, 0), 'STAGE 1/8  PISTOL  0/3   enemy 3/8');
  assert.equal(armsLine(null), '');
  assert.equal(stageText(1, 2), 'RED ADVANCES: SHOTGUN');
  assert.equal(ownStageBanner(0), 'STAGE 1: PISTOL');
  assert.equal(ENEMY_STAGE_BANNER, 'ENEMY ADVANCES');
});

test('modes: arms is a team mode without a kill score limit; the match carries the ladder and ends on it', () => {
  assert.equal(MODES.arms.teams, true);
  assert.equal(MODES.arms.arms, true);
  assert.equal(MODES.arms.scoreLimit, Infinity);
  assert.equal(botConfigFor('arms').fill, 6);
  const m = newMatch('arms');
  assert.deepEqual(m.arms, { stages: [0, 0], progress: [0, 0], won: -1 });
  startMatch(m, 1000);
  const blue = { id: 1, team: 0, kills: 0, deaths: 0, name: 'b' }, red = { id: 2, team: 1, kills: 0, deaths: 0, name: 'r' };
  for (let i = 0; i < 60; i++) scoreKill(m, blue, red); // kills count on the board but never end an arms match
  assert.equal(m.teamScores[0], 60);
  assert.equal(endReason(m, [blue, red], 2000), null);
  assert.deepEqual(matchSnapshot(m, 2000).arms, { stages: [0, 0], progress: [0, 0] });
  m.arms.won = 1;
  assert.equal(endReason(m, [blue, red], 2000), 'score');
  const res = endMatch(m, [blue, red], 2000, 'score');
  assert.deepEqual(res.winner, { type: 'team', team: 1, name: 'Red' }, 'the ladder, not the 60 kills, names the winner');
  const t = newMatch('arms'); startMatch(t, 0);
  t.arms.stages = [2, 2]; t.arms.progress = [1, 2];
  assert.equal(endMatch(t, [], 1, 'time').winner.team, 1);
  t.arms.progress = [2, 2];
  assert.equal(endMatch(t, [], 1, 'time').winner.type, 'draw');
  assert.equal(newMatch('tdm').arms, null);
  startMatch(m, 5000);
  assert.equal(m.arms.won, -1, 'a new match starts on the first stage');
});
