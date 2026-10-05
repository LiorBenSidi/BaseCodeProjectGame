import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADAR, AFK, cmdIsActive, radarActive, radarNextIn, afkEligible, isAfk } from '../../src/shared/presence.js';
import { GameRoom } from '../../src/server/GameRoom.js';

const cmd = (o = {}) => ({ seq: 1, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tac: false, yaw: 0, pitch: 0, ...o });

test('SPEC 37.4: a zero command is idle; movement, jumps, sprint, crouch or a turn count as activity', () => {
  assert.equal(cmdIsActive(cmd()), false);
  assert.equal(cmdIsActive(cmd({ fwd: 1 })), true);
  assert.equal(cmdIsActive(cmd({ right: -0.3 })), true);
  assert.equal(cmdIsActive(cmd({ jump: true })), true);
  assert.equal(cmdIsActive(cmd({ crouch: true })), true);
  assert.equal(cmdIsActive(cmd({ yaw: 0.2 }), 0, 0), true);
  assert.equal(cmdIsActive(cmd({ yaw: 0.2 }), 0.2, 0), false); // same look direction as before: idle
  assert.equal(cmdIsActive(null), false);
});

test('SPEC 37.1: the radar reveals during the last 1.5 s of every 5 s, deathmatch only', () => {
  assert.equal(RADAR.periodMs, 5000);
  assert.equal(RADAR.showMs, 1500);
  assert.equal(radarActive('dm', 0), false);
  assert.equal(radarActive('dm', 3499), false);
  assert.equal(radarActive('dm', 3500), true);
  assert.equal(radarActive('dm', 4999), true);
  assert.equal(radarActive('dm', 5000), false);
  assert.equal(radarActive('dm', 8600), true);
  assert.equal(radarActive('tdm', 4000), false);
  assert.equal(radarActive('range', 4000), false);
  assert.equal(radarActive('dm', -1), false);
  assert.equal(radarActive('dm', Infinity), false);
  assert.equal(radarNextIn(0), 3500);
  assert.equal(radarNextIn(3000), 500);
  assert.equal(radarNextIn(4000), 0);
  assert.equal(radarNextIn(5000), 3500);
});

test('SPEC 37.4: AFK after 60 s idle in dm and tdm, never in the range', () => {
  assert.equal(AFK.idleMs, 60_000);
  assert.equal(afkEligible('dm'), true);
  assert.equal(afkEligible('tdm'), true);
  assert.equal(afkEligible('range'), false);
  assert.equal(isAfk(0, 59_999), false);
  assert.equal(isAfk(0, 60_000), true);
});

function roomAt() {
  let now = 100_000;
  const room = new GameRoom({ now: () => now, random: () => 0.5, mode: 'dm' });
  const seen = [];
  const id = room.addPlayer({ send: (m) => seen.push(m), name: 'Idle' }).id;
  const other = room.addPlayer({ send: () => {}, name: 'Other' }).id;
  const advance = (ms) => { now += ms; };
  const snap = () => seen.filter((m) => m.t === 'snap').at(-1);
  return { room, id, other, advance, snap, seen, now: () => now };
}

test('SPEC 37.4: an idle human becomes afk after 60 s, a brain moves the body, an active command hands it back', () => {
  const { room, id, advance, snap } = roomAt();
  // zero commands at 60 Hz for 61 s do not count as activity
  let seq = 0;
  for (let t = 0; t < 61_000; t += 1000) {
    room.handleInput(id, [cmd({ seq: ++seq })]);
    advance(1000);
    room.tick();
  }
  // the match needs to be live for AFK to apply (the intro is skipped on the first match, see modes.js)
  let s = snap();
  assert.equal(s.players.find((p) => p.id === id).afk, 1);
  // the brain drives the body: after a few seconds the player has moved from the spawn
  const before = s.players.find((p) => p.id === id);
  const ackBefore = s.ack;
  for (let i = 0; i < 90; i++) { advance(33); room.tick(); }
  s = snap();
  const after = s.players.find((p) => p.id === id);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.5, 'the brain moved the body');
  assert.equal(s.ack, ackBefore, 'the brain never advances the human sequence');
  assert.ok(ackBefore <= seq);
  // a zero command does nothing; a move command hands the body back
  room.handleInput(id, [cmd({ seq: ++seq })]);
  room.tick();
  assert.equal(snap().players.find((p) => p.id === id).afk, 1);
  room.handleInput(id, [cmd({ seq: ++seq, fwd: 1, yaw: after.yaw, pitch: 0 })]);
  room.tick();
  assert.equal(snap().players.find((p) => p.id === id).afk, undefined);
});

test('SPEC 37.1: in dm the snapshot carries radar: 1 and sc: 1 for everybody during the pulse, nothing otherwise', () => {
  const { room, advance, snap } = roomAt();
  room.tick();
  assert.equal(snap().radar, undefined);
  assert.equal(snap().players.every((p) => p.sc === 0), true);
  advance(3600); room.tick();
  assert.equal(snap().radar, 1);
  assert.equal(snap().players.every((p) => p.sc === 1), true);
  advance(1500); room.tick();
  assert.equal(snap().radar, undefined);
});

test('SPEC 37.1: no radar in tdm', () => {
  let now = 0;
  const room = new GameRoom({ now: () => now, random: () => 0.5, mode: 'tdm' });
  const seen = [];
  room.addPlayer({ send: (m) => seen.push(m), name: 'A' });
  room.addPlayer({ send: () => {}, name: 'B' });
  now = 4000; room.tick();
  assert.equal(seen.filter((m) => m.t === 'snap').at(-1).radar, undefined);
});
