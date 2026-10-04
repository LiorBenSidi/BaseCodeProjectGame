// SPEC 34 (D-031): medals, intro countdown, next-map vote, kill cam and minimap math, ceremony views.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MODES, ENDING_MS, INTRO_MS, newMatch, startMatch, endMatch, recordVote, tallyVotes, voteCandidatesFor, voteCounts, matchSnapshot, updateIntroPhase } from '../../src/shared/modes.js';
import { MEDALS, newMedalTracker, recordKillMedals, matchEndMedals, medalCount, MULTI_KILL_MS } from '../../src/shared/medals.js';
import { MAP_IDS, MAPS } from '../../src/shared/maps.js';
import { parseClientMessage } from '../../src/server/protocol.js';
import { introText, podium, mvp, medalLines, voteView, killcamWindow, killcamSample, trimHistory, minimapLayout } from '../../src/client/ceremony.js';

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, ...opts });
  return { room, clock, advance: (ms) => { clock.t += ms; } };
}
function join(room, name, x, z) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  Object.assign(p, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}

test('medals: first blood, multi kills inside 4 s, headshot, longshot and point blank, revenge, comeback, buzzkill, flawless', () => {
  const tr = newMedalTracker();
  assert.deepEqual(recordKillMedals(tr, { killerId: 'a', victimId: 'b', nowMs: 0, dist: 10 }), ['first_blood']);
  assert.deepEqual(recordKillMedals(tr, { killerId: 'a', victimId: 'c', nowMs: 1000, dist: 35, isHeadshot: true }), ['double', 'headshot', 'longshot']);
  assert.deepEqual(recordKillMedals(tr, { killerId: 'a', victimId: 'd', nowMs: 2000, dist: 1 }), ['triple', 'pointblank']);
  assert.deepEqual(recordKillMedals(tr, { killerId: 'a', victimId: 'e', nowMs: 3900, dist: 10 }), ['quad']);
  assert.deepEqual(recordKillMedals(tr, { killerId: 'a', victimId: 'f', nowMs: 3900 + MULTI_KILL_MS + 1, dist: 10 }), [], 'window expired: only the kills inside 4 s count');
  // b kills a: revenge for b (a killed b first)
  assert.deepEqual(recordKillMedals(tr, { killerId: 'b', victimId: 'a', nowMs: 9000, dist: 10 }), ['revenge', 'buzzkill'], 'a had a streak of 5');
  // c dies three times without a kill, then kills: comeback
  recordKillMedals(tr, { killerId: 'a', victimId: 'c', nowMs: 20000, dist: 10 });
  recordKillMedals(tr, { killerId: 'a', victimId: 'c', nowMs: 30000, dist: 10 });
  const cb = recordKillMedals(tr, { killerId: 'c', victimId: 'a', nowMs: 40000, dist: 10 });
  assert.ok(cb.includes('comeback') && cb.includes('revenge'), JSON.stringify(cb));
  assert.deepEqual(recordKillMedals(tr, { killerId: 'z', victimId: 'z', nowMs: 1 }), [], 'self kill earns nothing');
  const totals = matchEndMedals(tr, [{ id: 'a', kills: 7, deaths: 2 }, { id: 'g', kills: 3, deaths: 0 }, { id: 'h', kills: 2, deaths: 0 }]);
  assert.equal(totals.g?.flawless, 1, '3 kills and 0 deaths');
  assert.equal(totals.h, undefined, 'two kills is not flawless');
  assert.equal(totals.a.first_blood, 1);
  assert.equal(medalCount(totals.a), Object.values(totals.a).reduce((x, y) => x + y, 0));
  for (const id of Object.keys(MEDALS)) assert.ok(MEDALS[id].name && MEDALS[id].short.length <= 3 && MEDALS[id].desc);
});

test('match flow: the first match starts at once; a restart runs the 5 s intro with a countdown in the snapshot, then goes live', () => {
  const m = newMatch('dm');
  startMatch(m, 1000);
  assert.equal(m.phase, 'playing');
  assert.equal(m.number, 1);
  startMatch(m, 5000, { intro: true });
  assert.equal(m.phase, 'intro');
  assert.equal(m.number, 2);
  assert.equal(matchSnapshot(m, 5000).left, 5);
  assert.equal(matchSnapshot(m, 7500).left, 3);
  assert.equal(updateIntroPhase(m, 5000 + INTRO_MS - 1), false);
  assert.equal(updateIntroPhase(m, 5000 + INTRO_MS), true);
  assert.equal(m.phase, 'playing');
  assert.equal(m.endsAt, 5000 + INTRO_MS + MODES.dm.timeLimitMs, 'the clock starts when play starts');
  assert.ok(INTRO_MS === 5000 && ENDING_MS >= 10000, 'enough time to read the podium and vote');
});

test('vote: two candidates excluding the current map, one vote per player, ties to the first candidate, no votes means rotation', () => {
  assert.deepEqual(voteCandidatesFor(['arena', 'foundry', 'crossfire'], 'arena'), ['foundry', 'crossfire']);
  assert.deepEqual(voteCandidatesFor(['arena', 'foundry', 'crossfire'], 'foundry'), ['arena', 'crossfire']);
  const m = newMatch('dm');
  startMatch(m, 0);
  endMatch(m, [], 1000, 'time', ['foundry', 'crossfire']);
  assert.equal(tallyVotes(m), null, 'nobody voted');
  assert.equal(recordVote(m, 'p1', 'arena'), false, 'not offered');
  assert.equal(recordVote(m, 'p1', 'crossfire'), true);
  assert.equal(recordVote(m, 'p2', 'foundry'), true);
  assert.equal(tallyVotes(m), 'foundry', 'tie goes to the first offered (rotation order)');
  assert.equal(recordVote(m, 'p1', 'foundry'), true, 'a player may change their vote');
  assert.deepEqual(voteCounts(m), { foundry: 2, crossfire: 0 });
  assert.equal(tallyVotes(m), 'foundry');
  recordVote(m, 'p3', 'crossfire'); recordVote(m, 'p4', 'crossfire'); recordVote(m, 'p5', 'crossfire');
  assert.equal(tallyVotes(m), 'crossfire');
  assert.deepEqual(matchSnapshot(m, 1000).voteCandidates, ['foundry', 'crossfire']);
  m.phase = 'playing';
  assert.equal(recordVote(m, 'p1', 'foundry'), false, 'no voting during play');
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'vote', mapId: 'foundry', extra: 1 })), { ok: true, msg: { t: 'vote', mapId: 'foundry' } });
  assert.equal(parseClientMessage(JSON.stringify({ t: 'vote', mapId: 'a'.repeat(33) })).ok, false);
});

test('room: matchEnd carries candidates and medals, votes are counted and broadcast, the voted map loads after the intro, nobody moves during the intro', () => {
  const { room, advance } = newRoom();
  const a = join(room, 'A', 30, 30);
  const b = join(room, 'B', 30, 26);
  room.tick();
  assert.equal(a.lastSnap().match.phase, 'playing', 'first match: no intro');
  const first = a.of('matchStart')[0].map.id;
  a.p.kills = 7; b.p.kills = 2;
  advance(MODES.dm.timeLimitMs); room.tick();
  const [end] = a.of('matchEnd');
  assert.deepEqual(end.voteCandidates, voteCandidatesFor(MAP_IDS, first));
  assert.equal(typeof end.medals, 'object');
  const pick = end.voteCandidates[1];
  room.handleVote(a.p.id, pick);
  room.handleVote(b.p.id, 'not-a-map');
  const votes = a.of('vote');
  assert.equal(votes.length, 1, 'only the valid vote broadcasts');
  assert.equal(votes[0].counts[pick], 1);
  advance(ENDING_MS); room.tick();
  const start = a.of('matchStart').at(-1);
  assert.equal(start.map.id, pick, 'the voted map, not the rotation');
  assert.equal(a.lastSnap().match.phase, 'intro');
  // frozen: inputs do not move the player during the intro
  const x0 = a.p.x;
  room.handleInput(a.p.id, { cmds: [{ seq: 1, fwd: 1, right: 0, jump: false, sprint: true, crouch: false }] });
  room.tick();
  assert.equal(a.p.x, x0);
  advance(INTRO_MS); room.tick();
  assert.equal(a.lastSnap().match.phase, 'playing');
  assert.equal(a.of('matchLive').length, 1);
  assert.ok(MAPS[pick], 'candidate is a real map');
});

test('ceremony views: intro text, podium with K/D and medal counts, MVP, my medal lines, vote shares', () => {
  assert.equal(introText(4.2), '5'); assert.equal(introText(1), '1'); assert.equal(introText(0), 'GO');
  const ranking = [{ id: 'a', name: 'A', k: 10, d: 2 }, { id: 'b', name: 'B', k: 4, d: 0 }, { id: 'c', name: 'C', k: 1, d: 5 }, { id: 'd', name: 'D', k: 0, d: 0 }];
  const medals = { a: { first_blood: 1, double: 2 }, b: { flawless: 1 } };
  const rows = podium(ranking, medals, 'b');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
  assert.equal(rows[0].kd, '5.00'); assert.equal(rows[0].medals, 3); assert.equal(rows[1].me, true); assert.equal(rows[1].kd, '4.00'); assert.equal(rows[2].kd, '0.20');
  assert.equal(mvp(ranking).id, 'a'); assert.equal(mvp([]), null);
  assert.deepEqual(medalLines(medals, 'a').map((l) => `${l.id}:${l.count}`), ['double:2', 'first_blood:1']);
  assert.deepEqual(medalLines({ a: { bogus: 3 } }, 'a'), [], 'unknown medal ids are dropped');
  const v = voteView(['foundry', 'crossfire'], { foundry: 3, crossfire: 1 }, 'crossfire', { foundry: 'Foundry' });
  assert.equal(v[0].key, 1); assert.equal(v[0].name, 'Foundry'); assert.equal(v[0].share, 0.75); assert.equal(v[1].name, 'crossfire'); assert.equal(v[1].mine, true);
  assert.equal(voteView(['x'], {}, null)[0].share, 0);
});

test('kill cam: the window ends before the respawn; samples interpolate position and wrap yaw; history trims to 6 s', () => {
  const w = killcamWindow(10000, 3000);
  assert.equal(w.to, 10000); assert.equal(w.duration, 2500); assert.equal(w.from, 7500);
  assert.equal(killcamWindow(10000, 1000).duration, 500);
  const hist = [{ t: 0, x: 0, y: 0, z: 0, yaw: 3.0, pitch: 0, h: 1.8 }, { t: 100, x: 10, y: 1, z: -10, yaw: -3.0, pitch: 0.5, h: 1.0 }];
  const s = killcamSample(hist, 50);
  assert.equal(s.x, 5); assert.equal(s.y, 0.5); assert.equal(s.z, -5); assert.equal(s.pitch, 0.25); assert.equal(s.h, 1.4);
  assert.ok(Math.abs(Math.abs(s.yaw) - Math.PI) < 0.15, `yaw goes the short way round through pi, got ${s.yaw}`);
  assert.equal(killcamSample(hist, -5).x, 0); assert.equal(killcamSample(hist, 500).x, 10);
  assert.equal(killcamSample([], 1), null);
  const h = Array.from({ length: 100 }, (_, i) => ({ t: i * 100 }));
  trimHistory(h, 9900, 6000);
  assert.ok(h.length <= 62 && h[0].t <= 3900 && h[0].t >= 3800, `kept the last 6 s (${h.length} samples from ${h[0].t})`);
});

test('minimap: boxes project into the square, allies always show, enemies only near or after firing, me arrow at my position', () => {
  const map = { half: 20, boxes: [{ min: [-20, 0, -21], max: [20, 3, -20] }, { min: [0, 0, 0], max: [2, 1, 2] }, { min: [5, 0, 5], max: [6, 0.5, 6] }] };
  const me = { x: 0, z: 0, yaw: 1 };
  const others = [
    { id: 'ally', x: 15, z: 15, team: 0, alive: 1 },
    { id: 'far', x: 15, z: -15, team: 1, alive: 1 },
    { id: 'near', x: 5, z: 5, team: 1, alive: 1 },
    { id: 'shooter', x: -15, z: -15, team: 1, alive: 1 },
    { id: 'dead', x: 1, z: 1, team: 1, alive: 0 },
  ];
  const lay = minimapLayout(map, me, others, 160, { now: 5000, team: 0, lastShotAt: new Map([['shooter', 3500]]) });
  assert.equal(lay.boxes.length, 2, 'the half metre prop is not drawn');
  assert.equal(lay.boxes[0].tall, true); assert.equal(lay.boxes[1].tall, false);
  assert.deepEqual(lay.boxes[1], { x: 80, y: 80, w: 8, h: 8, tall: false });
  assert.deepEqual(lay.me, { x: 80, y: 80, yaw: 1 });
  assert.deepEqual(lay.dots.map((d) => d.id).sort(), ['ally', 'near', 'shooter']);
  assert.equal(lay.dots.find((d) => d.id === 'ally').kind, 'ally');
  const dm = minimapLayout(map, me, others, 160, { now: 5000, team: -1, lastShotAt: new Map() });
  assert.deepEqual(dm.dots.map((d) => d.id), ['near'], 'in DM everyone is an enemy: only the near one shows');
  const stale = minimapLayout(map, me, others, 160, { now: 9000, team: 0, lastShotAt: new Map([['shooter', 3500]]) });
  assert.equal(stale.dots.some((d) => d.id === 'shooter'), false, 'the shot reveal expires');
});
