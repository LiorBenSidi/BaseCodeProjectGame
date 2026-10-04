// SPEC 28: the map registry, rotation and map validity (every spawn and pickup stands on free ground).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAP_IDS, DEFAULT_MAP, mapDef, isMap, mapForMatch, describeMap } from '../../src/shared/maps.js';
import { MAP } from '../../src/shared/map.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { ENDING_MS } from '../../src/shared/modes.js';

const insideBox = (b, x, y, z) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && y >= b.min[1] && y < b.max[1];

test('registry: arena is the default and identical to MAP; every map is self-consistent', () => {
  assert.equal(DEFAULT_MAP, 'arena');
  assert.deepEqual(MAPS.arena.boxes, MAP.boxes);
  assert.ok(MAP_IDS.length >= 3);
  for (const id of MAP_IDS) {
    const m = mapDef(id);
    assert.equal(m.id, id);
    assert.ok(m.half >= 30 && m.half <= 60, `${id} half`);
    assert.ok(m.spawns.length >= 8, `${id} spawns`);
    assert.ok(m.pickups.some((p) => p.type === 'sniper'), `${id} has a sniper`);
    assert.ok(m.pickups.filter((p) => p.type === 'health').length >= 2, `${id} health`);
    for (const b of m.boxes) for (let i = 0; i < 3; i++) assert.ok(b.max[i] > b.min[i], `${id} box degenerate`);
    for (const s of m.spawns) {
      assert.ok(Math.abs(s.x) < m.half && Math.abs(s.z) < m.half, `${id} spawn in bounds`);
      assert.ok(!m.boxes.some((b) => insideBox(b, s.x, 0.1, s.z)), `${id} spawn ${s.x},${s.z} inside a box`);
    }
    for (const p of m.pickups) {
      const y = (p.y ?? 0) + 0.1;
      assert.ok(!m.boxes.some((b) => insideBox(b, p.x, y, p.z)), `${id} pickup ${p.type} at ${p.x},${p.z} inside a box`);
      if ((p.y ?? 0) > 0) assert.ok(m.boxes.some((b) => Math.abs(b.max[1] - p.y) < 1e-9 && p.x >= b.min[0] && p.x <= b.max[0] && p.z >= b.min[2] && p.z <= b.max[2]), `${id} raised pickup ${p.type} stands on a box top`);
    }
  }
  assert.throws(() => mapDef('nope'), RangeError);
  assert.equal(isMap('foundry'), true);
  assert.equal(isMap('x'), false);
  const d = describeMap(MAPS.foundry);
  assert.deepEqual(Object.keys(d), ['id', 'name', 'half', 'boxes']);
});

test('rotation: match 1 is arena, then the registry order, wrapping', () => {
  assert.equal(mapForMatch(1), 'arena');
  assert.equal(mapForMatch(2), MAP_IDS[1]);
  assert.equal(mapForMatch(MAP_IDS.length + 1), 'arena');
  assert.equal(mapForMatch(0), 'arena');
});

test('room: welcome carries the arena, the next match switches map, pickups and spawns follow', () => {
  let t = 1_000_000;
  const sent = [];
  const room = new GameRoom({ now: () => t, random: () => 0 });
  const p = room.addPlayer({ name: 'A', send: (m) => sent.push(m) });
  const welcome = sent.find((m) => m.t === 'welcome');
  assert.equal(welcome.map.id, 'arena');
  assert.equal(welcome.map.boxes.length, MAP.boxes.length);
  t += 300_001; room.tick(); // DM time limit ends match 1
  assert.ok(sent.some((m) => m.t === 'matchEnd'));
  t += ENDING_MS + 1; room.tick();
  const start = sent.filter((m) => m.t === 'matchStart').at(-1);
  assert.equal(start.map.id, MAP_IDS[1]);
  assert.equal(start.pickups.length, MAPS[MAP_IDS[1]].pickups.length);
  const next = MAPS[MAP_IDS[1]];
  assert.ok(next.spawns.some((s) => Math.abs(s.x - p.x) < 1e-6 && Math.abs(s.z - p.z) < 1e-6), 'respawned on the new map');
});
