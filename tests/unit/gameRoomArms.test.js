// SPEC 40.3 at room level: no pickups, stage loadouts on spawn, a stage change re-arms the team and is broadcast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { ARMS_KILLS_PER_STAGE } from '../../src/shared/armsRace.js';

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
const ticks = (room, advance, n) => { for (let i = 0; i < n; i += 1) { advance(1000 / 30); room.tick(); } };
// Victim two units in front of the shooter, at the shooter's eye line, with 1 hp: one round of anything kills.
function faceOff(s, v) {
  v.p.x = s.p.x + Math.sin(s.p.yaw) * -2; v.p.z = s.p.z + Math.cos(s.p.yaw) * -2; v.p.y = 0;
  const dx = v.p.x - s.p.x, dz = v.p.z - s.p.z;
  s.p.yaw = Math.atan2(-dx, -dz); s.p.pitch = 0;
  v.p.hp = 1;
}

test('arms: welcome lists no pickups, everyone spawns with the pistol in both slots', () => {
  const { room } = newRoom({ mode: 'arms' });
  const a = join(room, 'A'), b = join(room, 'B');
  assert.deepEqual(a.of('welcome')[0].pickups, []);
  assert.equal(a.of('welcome')[0].mode, 'arms');
  for (const j of [a, b]) {
    assert.equal(j.p.loadout.primary.id, 'pistol');
    assert.equal(j.p.loadout.sidearm.id, 'pistol');
  }
  room.tick();
  assert.deepEqual(a.lastSnap().match.arms, { stages: [0, 0], progress: [0, 0] });
});

test('arms: three kills re-arm the killer team with the SMG at once and broadcast the stage; the victim respawns on its own stage', () => {
  const { room, advance } = newRoom({ mode: 'arms' });
  const a = join(room, 'A'), b = join(room, 'B');
  assert.notEqual(a.p.team, b.p.team);
  let kills = 0;
  for (let attempt = 0; attempt < 400 && kills < ARMS_KILLS_PER_STAGE; attempt++) {
    if (!b.p.alive) { ticks(room, advance, 1); continue; }
    faceOff(a, b);
    room.handleShoot(a.p.id);
    room.tick();
    if (!b.p.alive) kills++;
    else ticks(room, advance, 20); // let the trigger interval and any reload pass
  }
  assert.equal(kills, ARMS_KILLS_PER_STAGE, 'the shooter landed three kills');
  const stage = a.of('stage');
  assert.equal(stage.length, 1);
  assert.deepEqual({ team: stage[0].team, stage: stage[0].stage, weapon: stage[0].weapon }, { team: a.p.team, stage: 1, weapon: 'smg' });
  assert.match(stage[0].text, /^(BLUE|RED) ADVANCES: SMG$/);
  assert.equal(a.p.loadout.primary.id, 'smg', 'the living killer was re-armed immediately');
  assert.equal(a.p.loadout.primary.mag > 0, true);
  ticks(room, advance, 200); // the victim respawns
  assert.equal(b.p.alive, true);
  assert.equal(b.p.loadout.primary.id, 'pistol', 'the other team is still on stage one');
  const snap = a.lastSnap().match;
  assert.equal(snap.arms.stages[a.p.team], 1);
  assert.equal(snap.arms.progress[a.p.team], 0);
  assert.equal(snap.ts[a.p.team], 3, 'kills still show on the board');
  room.removePlayer(a.p.id); room.removePlayer(b.p.id);
});
