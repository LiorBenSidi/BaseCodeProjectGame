// SPEC 39.5: bots play the objective. Pure brain tests plus a room-level drive on KOTH and CTF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBrain, botStep, objectiveGoal } from '../../src/shared/bots.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MAPS } from '../../src/shared/maps.js';

const bot = (team, x, z) => ({ id: 1, team, x, y: 0, z, alive: true, loadout: null });
const hill = { kind: 'hill', x: 0, z: -16, r: 5, holder: -1, contested: false, next: 30 };
const flags = (own, enemy, carrying = false) => ({ kind: 'flags', carrying, bases: [{ x: -32, z: -32, r: 3 }, { x: 32, z: 32, r: 3 }], flags: [{ team: 0, state: own, x: -32, z: -32 }, { team: 1, state: enemy, x: 32, z: 32 }] });

test('objectiveGoal: hill ring spots, carrier runs home, defenders recover, attackers take', () => {
  const b0 = newBrain('medium', 0), b1 = newBrain('medium', 1);
  const g = objectiveGoal(hill, bot(0, 20, 20), b0);
  assert.ok(Math.hypot(g.x - hill.x, g.z - hill.z) <= hill.r - 1.9, 'inside the hill');
  assert.equal(g.label, 'hill');
  assert.equal(objectiveGoal(hill, bot(-1, 0, 0), b0), null, 'no team, no objective');
  assert.equal(objectiveGoal(flags('home', 'home', true), bot(0, 0, 0), b0).label, 'home');
  assert.equal(objectiveGoal(flags('carried', 'home'), bot(0, 0, 0), b1).label, 'recover');
  assert.equal(objectiveGoal(flags('carried', 'home'), bot(0, 0, 0), b0).label, 'take', 'even seeds keep attacking');
  assert.equal(objectiveGoal(flags('dropped', 'home'), bot(0, 0, 0), b0).label, 'recover', 'everyone recovers a dropped flag');
  assert.equal(objectiveGoal(flags('home', 'carried'), bot(0, 0, 0), b0).label, 'escort');
  assert.deepEqual([objectiveGoal(flags('home', 'home'), bot(0, 0, 0), b0).x, objectiveGoal(flags('home', 'home'), bot(0, 0, 0), b0).z], [32, 32]);
});

test('botStep: with an objective the bot walks toward it, holds on arrival, and a carrier ignores enemies', () => {
  const brain = newBrain('medium', 2);
  const b = bot(0, 0, 20);
  const r = botStep(brain, b, [], MAPS.arena, 1000, () => 0.3, undefined, hill);
  assert.ok(r.cmd.fwd > 0, 'moving');
  assert.ok(Math.abs(brain.waypoint.x - hill.x) < 5 && Math.abs(brain.waypoint.z - hill.z) < 5, 'waypoint is the hill');
  b.x = hill.x; b.z = hill.z;
  const held = botStep(brain, b, [], MAPS.arena, 1200, () => 0.3, undefined, hill);
  assert.equal(held.cmd.fwd, 0, 'holds the hill');
  assert.notEqual(held.cmd.right, 0, 'shuffles');
  const enemy = { id: 9, team: 1, x: hill.x, y: 0, z: hill.z - 6, alive: true, yaw: 0, pitch: 0 };
  const c = newBrain('medium', 4);
  const carrierBot = bot(0, 0, 0);
  for (let t = 0; t < 10; t += 1) botStep(c, carrierBot, [enemy], MAPS.arena, 2000 + t * 130, () => 0.3, undefined, flags('home', 'carried', true));
  const run = botStep(c, carrierBot, [enemy], MAPS.arena, 4000, () => 0.3, undefined, flags('home', 'carried', true));
  assert.equal(run.shoot, false, 'the carrier does not fight');
  assert.ok(run.cmd.fwd > 0);
});

test('room: six KOTH bots score on the hill within two minutes; CTF bots capture within four minutes', () => {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0.5, mode: 'koth', botFill: 6, botSeed: 7 });
  const inbox = [];
  const human = room.addPlayer({ send: (m) => inbox.push(m), name: 'H' });
  Object.assign(human, { x: 30, y: 0, z: 30, afk: false });
  for (let i = 0; i < 30 * 120; i += 1) { clock.t += 1000 / 30; room.tick(); }
  const ts = room.matchState.ts;
  assert.ok(ts[0] + ts[1] >= 10, `the hill was held: ${ts}`);
  room.removePlayer(human.id);

  const c2 = { t: 1000 };
  const ctf = new GameRoom({ now: () => c2.t, random: () => 0.5, mode: 'ctf', botFill: 6, botSeed: 3 });
  const h2 = ctf.addPlayer({ send: () => {}, name: 'H' });
  let captures = 0;
  for (let i = 0; i < 30 * 240 && captures === 0; i += 1) { c2.t += 1000 / 30; ctf.tick(); captures = ctf.matchState.ts[0] + ctf.matchState.ts[1]; }
  assert.ok(captures >= 1, 'a flag was captured');
  ctf.removePlayer(h2.id);
});
