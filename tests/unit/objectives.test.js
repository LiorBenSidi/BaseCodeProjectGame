// SPEC 39 (D-038): objective rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHillState, stepHill, hillSnapshot, currentHill, HILL_ROTATE_MS, HILL_RADIUS, newFlagState, stepFlags, flagsSnapshot, carrying, flagEventText, FLAG_RETURN_MS, BASE_RADIUS } from '../../src/shared/objectives.js';
import { MAPS, MAP_IDS, mapDef, describeMap } from '../../src/shared/maps.js';
import { MODES, newMatch, scoreKill, scoreObjective, endReason, startMatch, botConfigFor, TEAM_NAMES } from '../../src/shared/modes.js';

const pl = (id, team, x, z, alive = true) => ({ id, name: `P${id}`, team, x, z, alive, kills: 0, deaths: 0 });

test('every map carries at least two hills and exactly two bases, none inside a solid block', () => {
  for (const id of MAP_IDS) {
    const m = mapDef(id);
    assert.ok(m.hills.length >= 2, `${id} hills`);
    assert.equal(m.bases.length, 2, `${id} bases`);
    const solid = m.boxes.filter((b) => b.max[1] - b.min[1] > 1.3); // a 1.25 m step is walkable, taller blocks are not
    for (const pt of [...m.hills, ...m.bases]) {
      for (const b of solid) {
        const inside = pt.x > b.min[0] && pt.x < b.max[0] && pt.z > b.min[2] && pt.z < b.max[2];
        assert.equal(inside, false, `${id} objective at ${pt.x},${pt.z} sits inside a wall`);
      }
      assert.ok(Math.abs(pt.x) < m.half && Math.abs(pt.z) < m.half, `${id} objective inside the perimeter`);
    }
    const [a, b] = m.bases;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > m.half, `${id} bases are far apart`);
  }
  assert.ok(MAPS.summit && MAPS.canal, 'the two P9 maps are registered');
  assert.deepEqual(Object.keys(describeMap(MAPS.canal)), ['id', 'name', 'half', 'boxes', 'hills', 'bases']);
});

test('the objective modes exist, fill six bot seats, and kills do not score in them', () => {
  for (const id of ['koth', 'ctf']) {
    assert.equal(MODES[id].teams, true);
    assert.equal(botConfigFor(id).fill, 6);
    const m = newMatch(id);
    startMatch(m, 0);
    scoreKill(m, pl(1, 0, 0, 0), pl(2, 1, 0, 0));
    assert.deepEqual(m.teamScores, [0, 0], `${id}: a kill scores nothing`);
    scoreObjective(m, [2, 0]);
    assert.deepEqual(m.teamScores, [2, 0]);
  }
  const m = newMatch('ctf');
  startMatch(m, 0);
  scoreObjective(m, [0, MODES.ctf.scoreLimit]);
  assert.equal(endReason(m, [], 1000), 'score');
});

test('KOTH: hold scores one point per second, contested scores nothing, the hill rotates', () => {
  const h = newHillState(MAPS.arena, 0);
  const hill = currentHill(h);
  const blue = pl(1, 0, hill.x, hill.z), red = pl(2, 1, hill.x + HILL_RADIUS + 1, hill.z);
  let pts = [0, 0];
  for (let t = 0; t < 30; t += 1) { const p = stepHill(h, [blue, red], t * 100, 100); pts = [pts[0] + p[0], pts[1] + p[1]]; }
  assert.deepEqual(pts, [3, 0], 'three seconds held = three points');
  assert.equal(h.holder, 0);
  red.x = hill.x; // steps in: contested
  const p = stepHill(h, [blue, red], 3100, 1000);
  assert.deepEqual(p, [0, 0]);
  assert.equal(h.contested, true);
  assert.equal(h.holder, -1);
  blue.alive = false; // dead players do not hold
  stepHill(h, [blue, red], 3200, 100);
  assert.equal(h.holder, 1);
  const before = h.index;
  stepHill(h, [], HILL_ROTATE_MS + 1, 100);
  assert.equal(h.index, (before + 1) % h.hills.length, 'rotated');
  const snap = hillSnapshot(h, HILL_ROTATE_MS + 1);
  assert.equal(snap.kind, 'hill');
  assert.equal(snap.r, HILL_RADIUS);
  assert.ok(snap.next <= HILL_ROTATE_MS / 1000);
});

test('CTF: take, carry, capture only while the own flag is home; death drops; defenders and time return', () => {
  const f = newFlagState(MAPS.canal);
  const [bb, rb] = f.bases;
  const blue = pl(1, 0, rb.x, rb.z); // blue stands on the red base
  const red = pl(2, 1, 0, 0);
  let r = stepFlags(f, [blue, red], 0);
  assert.deepEqual(r.events.map((e) => e.type), ['take']);
  assert.equal(carrying(f, 1).team, 1);
  blue.x = bb.x; blue.z = bb.z; // runs home
  r = stepFlags(f, [blue, red], 100);
  assert.deepEqual(r.points, [1, 0]);
  assert.equal(r.events[0].type, 'capture');
  assert.equal(f.flags[1].state, 'home');
  // red takes blue's flag, then blue cannot capture while its own flag is out
  red.x = bb.x; red.z = bb.z;
  stepFlags(f, [blue, red], 200);
  assert.equal(f.flags[0].state, 'carried');
  blue.x = rb.x; blue.z = rb.z;
  stepFlags(f, [blue, red], 300); // takes red flag
  blue.x = bb.x; blue.z = bb.z;
  r = stepFlags(f, [blue, red], 400);
  assert.deepEqual(r.points, [0, 0], 'no capture while the own flag is away');
  // red dies: drop where they fell
  red.alive = false; red.x = 10; red.z = 4;
  r = stepFlags(f, [blue, red], 500);
  assert.equal(r.events[0].type, 'drop');
  assert.equal(f.flags[0].state, 'dropped');
  assert.deepEqual([f.flags[0].x, f.flags[0].z], [10, 4]);
  // a blue defender touches it: returns
  const blue2 = pl(3, 0, 10, 4);
  r = stepFlags(f, [blue, red, blue2], 600);
  assert.deepEqual(r.events.map((e) => e.type), ['return', 'capture'], 'the return re-arms the capture in the same step');
  assert.equal(f.flags[0].state, 'home');
  assert.deepEqual(r.points, [1, 0]);
  // time return
  f.flags[1].state = 'dropped'; f.flags[1].droppedAt = 1000; f.flags[1].x = 5; f.flags[1].z = 5;
  r = stepFlags(f, [], 1000 + FLAG_RETURN_MS);
  assert.equal(r.events[0].type, 'return');
  const snap = flagsSnapshot(f);
  assert.equal(snap.kind, 'flags');
  assert.equal(snap.bases[0].r, BASE_RADIUS);
  assert.equal(flagEventText({ type: 'capture', team: 1, name: 'Ace' }, TEAM_NAMES), 'Ace captured the Blue flag');
  assert.equal(flagEventText({ type: 'return', team: 0, name: '' }, TEAM_NAMES), 'The Blue flag returned home');
});
