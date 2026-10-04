// SPEC 35.3 (D-032): bots and the practice range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { DIFFICULTIES, newBrain, botStep, botName, botsWanted, seededRng, pickWaypoint, canSee, chooseTarget, BOT_NAMES, THINK_MS } from '../../src/shared/bots.js';
import { MODES, botConfigFor, newMatch, startMatch, endReason, matchSnapshot } from '../../src/shared/modes.js';
import { MAP } from '../../src/shared/map.js';
import { MAPS } from '../../src/shared/maps.js';
import { deriveMatchStatus } from '../../src/client/hudModel.js';
import { loadConfig } from '../../src/server/config.js';
import { parseRoomId } from '../../src/shared/rooms.js';

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, ...opts });
  return { room, clock, advance: (ms) => { clock.t += ms; } };
}
function join(room, name) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}
const OPEN = { half: 20, boxes: [], spawns: [{ x: 10, z: 10 }, { x: -10, z: -10 }] }; // no cover: pure brain behaviour
const player = (id, x, z, extra = {}) => ({ id, x, y: 0, z, alive: true, team: -1, yaw: 0, pitch: 0, ...extra });

test('seeded rng is deterministic and uniform enough; names rotate and avoid taken ones', () => {
  const a = seededRng(7), b = seededRng(7);
  const sa = Array.from({ length: 5 }, () => a()), sb = Array.from({ length: 5 }, () => b());
  assert.deepEqual(sa, sb);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  const mean = Array.from({ length: 2000 }, () => a()).reduce((x, y) => x + y, 0) / 2000;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ${mean}`);
  assert.equal(botName(newBrain('easy', 0)), BOT_NAMES[0]);
  assert.equal(botName(newBrain('easy', 0), new Set([BOT_NAMES[0]])), BOT_NAMES[1]);
  assert.equal(botName(newBrain('easy', 3)), BOT_NAMES[3]);
  for (const d of Object.values(DIFFICULTIES)) assert.ok(d.reactionMs > 0 && d.fireChance >= 0 && d.fireChance <= 1 && d.aimErrorRad >= 0);
});

test('waypoints are inside the arena and never inside a wall; line of sight respects walls', () => {
  const rng = seededRng(3);
  for (let i = 0; i < 40; i++) {
    const w = pickWaypoint(MAP, rng);
    assert.ok(Math.abs(w.x) <= MAP.half && Math.abs(w.z) <= MAP.half);
    const inside = MAP.boxes.some((b) => w.x > b.min[0] && w.x < b.max[0] && w.z > b.min[2] && w.z < b.max[2] && b.max[1] - b.min[1] > 0.4 && !MAP.spawns.some((s) => s.x === w.x && s.z === w.z));
    assert.equal(inside, false, `waypoint in a wall: ${JSON.stringify(w)}`);
  }
  const a = player(1, 0, 10), b = player(2, 0, -10);
  const wall = [{ min: [-5, 0, -0.5], max: [5, 3, 0.5] }];
  assert.equal(canSee(a, b, [], 60), true);
  assert.equal(canSee(a, b, wall, 60), false, 'the wall blocks');
  assert.equal(canSee(a, b, [], 15), false, 'out of range');
  const c = player(3, 3, 8, { team: 0 });
  assert.equal(chooseTarget({ ...a, team: 0 }, [b, c], [], 60)?.id, 2, 'teammate skipped, enemy chosen');
  assert.equal(chooseTarget(a, [{ ...b, alive: false }], [], 60), null, 'dead players are not targets');
});

test('brain: patrols toward a waypoint when alone, turns to and fires at a visible enemy after the reaction time, dummies never fire, stuck bots re-route', () => {
  const rng = seededRng(11);
  const brain = newBrain('hard', 0);
  const bot = player(1, 0, 0, { loadout: { active: 'primary', primary: { mag: 30 } } });
  let r = botStep(brain, bot, [bot], OPEN, 0, rng);
  assert.ok(r.cmd.fwd > 0 && !r.shoot && typeof r.cmd.yaw === 'number' && r.cmd.seq === 1, 'moving on patrol');
  const enemy = player(2, 0, -20);
  const others = [bot, enemy];
  let shots = 0, first = null;
  for (let t = 0; t <= 2000; t += 33) {
    r = botStep(brain, bot, others, OPEN, 1000 + t, rng);
    if (r.shoot) { shots += 1; if (first === null) first = t; }
  }
  assert.ok(shots > 5, `hard bot fires once settled (${shots})`);
  assert.ok(first >= DIFFICULTIES.hard.reactionMs - THINK_MS, `no shot before the reaction time (first ${first} ms)`);
  assert.ok(Math.abs(brain.yaw) < 0.15, `aimed toward -Z (yaw ${brain.yaw})`);
  assert.equal(r.cmd.right !== 0, true, 'strafing in a fight');
  // empty magazine: reload intent, no shot
  bot.loadout.primary.mag = 0;
  r = botStep(brain, bot, others, OPEN, 4000, rng);
  assert.equal(r.reload, true); assert.equal(r.shoot, false);
  // dummy never fires
  const dummy = newBrain('dummy', 1);
  let dummyShots = 0;
  for (let t = 0; t <= 3000; t += 33) if (botStep(dummy, player(5, 0, 0), [player(5, 0, 0), enemy], OPEN, t, rng).shoot) dummyShots += 1;
  assert.equal(dummyShots, 0);
  // stuck: same position for a second forces a new waypoint and a hop
  const stuck = newBrain('easy', 2);
  const still = player(7, 3, 3);
  botStep(stuck, still, [still], OPEN, 0, rng);
  const wp0 = stuck.waypoint;
  for (let t = 33; t <= 1200; t += 33) botStep(stuck, still, [still], OPEN, t, rng);
  assert.notDeepEqual(stuck.waypoint, wp0, 're-routed');
  const dead = botStep(stuck, { ...still, alive: false }, [still], OPEN, 2000, rng);
  assert.deepEqual([dead.cmd.fwd, dead.cmd.right, dead.shoot], [0, 0, false]);
});

test('botsWanted fills seats without displacing humans; per-mode config; range is endless and the HUD shows no timer', () => {
  assert.equal(botsWanted(1, 2, 16), 1); assert.equal(botsWanted(2, 2, 16), 0); assert.equal(botsWanted(1, 4, 16), 3); assert.equal(botsWanted(1, 20, 4), 3); assert.equal(botsWanted(5, 2, 16), 0);
  assert.deepEqual(botConfigFor('dm'), { fill: 2, difficulty: 'medium' });
  assert.deepEqual(botConfigFor('range'), { fill: 4, difficulty: 'dummy' });
  assert.deepEqual(botConfigFor('nope'), { fill: 0, difficulty: 'medium' });
  assert.equal(MODES.range.timeLimitMs, Infinity);
  const m = newMatch('range');
  startMatch(m, 1000);
  assert.equal(endReason(m, [{ kills: 999 }], 1000 + 10 * 3600 * 1000), null, 'ten hours later, still playing');
  const snap = matchSnapshot(m, 5000);
  assert.equal(snap.left, -1);
  assert.equal(deriveMatchStatus(snap).timer, '', 'no countdown in the range');
  assert.equal(deriveMatchStatus({ phase: 'playing', left: 65 }).timer, '1:05');
  assert.deepEqual(parseRoomId('range-abc234'), { mode: 'range', code: 'abc234' });
  assert.equal(loadConfig({ BOT_FILL: '0' }).botFill, 0);
  assert.equal(loadConfig({ BOT_FILL: '3' }).botFill, 3);
  assert.throws(() => loadConfig({ BOT_FILL: 'many' }), /BOT_FILL/);
});

test('room: bots fill to the configured seats when a human joins, are marked in the snapshot, leave as humans arrive, and vanish with the last human', () => {
  const { room } = newRoom({ botFill: 2 });
  const a = join(room, 'Ada');
  assert.equal(room.botCount, 1); assert.equal(room.humanCount, 1);
  room.tick();
  const snap = a.lastSnap();
  assert.equal(snap.players.length, 2);
  const bot = snap.players.find((p) => p.bot === 1);
  assert.ok(bot && BOT_NAMES.includes(bot.name), 'bot marked and named');
  assert.equal(snap.players.find((p) => p.id === a.p.id).bot, undefined, 'humans carry no bot flag');
  const b = join(room, 'Bob');
  assert.equal(room.botCount, 0, 'the second human took the bot seat');
  room.removePlayer(b.p.id);
  assert.equal(room.botCount, 1, 'the bot is back');
  room.removePlayer(a.p.id);
  assert.equal(room.botCount, 0); assert.equal(room.humanCount, 0);
  const { room: quiet } = newRoom();
  join(quiet, 'Solo');
  assert.equal(quiet.botCount, 0, 'no fill configured, no bots');
});

test('room: a medium bot moves, aims at the human and lands shots within a few seconds; the range dummies never hurt anyone', () => {
  const { room, advance } = newRoom({ botFill: 2, botSeed: 5 });
  const a = join(room, 'Ada');
  Object.assign(a.p, { x: 0, z: -8 });
  let moved = false, hp = 100;
  for (let i = 0; i < 60 * 8; i++) {
    advance(1000 / 60);
    Object.assign(a.p, { x: 0, z: -8, vx: 0, vz: 0 }); // the human stands still in the open
    room.tick();
    const s = a.lastSnap();
    const b = s.players.find((p) => p.bot === 1);
    if (b && (Math.abs(b.x) > 0.5 || Math.abs(b.z) > 0.5)) moved = true;
    hp = Math.min(hp, s.players.find((p) => p.id === a.p.id).hp);
  }
  assert.equal(moved, true, 'the bot moved');
  assert.ok(hp < 100, `the bot hit the human (hp ${hp})`);
  assert.ok(a.of('shot').some((m) => m.id !== a.p.id), 'bot shots are broadcast like any other');
  const range = newRoom({ mode: 'range', botFill: 4, botDifficulty: 'dummy' });
  const r = join(range.room, 'Ada');
  assert.equal(range.room.botCount, 3);
  for (let i = 0; i < 60 * 5; i++) { range.advance(1000 / 60); range.room.tick(); }
  assert.equal(r.lastSnap().players.find((p) => p.id === r.p.id).hp, 100, 'dummies never shoot');
  assert.equal(r.lastSnap().match.phase, 'playing');
});
