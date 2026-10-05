// SPEC 39: client-side objective presentation (pure parts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMatchStatus, deriveObjectiveLine } from '../../src/client/hudModel.js';
import { minimapLayout, objectiveMarks } from '../../src/client/ceremony.js';

const hill = { kind: 'hill', x: 0, z: -16, r: 5, holder: -1, contested: false, next: 42 };
const flags = { kind: 'flags', bases: [{ x: -32, z: -32, r: 3 }, { x: 32, z: 32, r: 3 }], flags: [{ team: 0, state: 'home', x: -32, z: -32, carrier: null }, { team: 1, state: 'carried', x: 4, z: 5, carrier: 7 }] };

test('objective line: hill states and flag states read at a glance', () => {
  assert.equal(deriveObjectiveLine(hill), 'HILL OPEN  moves in 42s');
  assert.equal(deriveObjectiveLine({ ...hill, holder: 1 }, null, 0), 'HILL HELD BY RED  moves in 42s');
  assert.equal(deriveObjectiveLine({ ...hill, holder: 0 }, null, 0), 'HILL HELD BY YOU  moves in 42s');
  assert.equal(deriveObjectiveLine({ ...hill, contested: true }), 'HILL CONTESTED  moves in 42s');
  assert.equal(deriveObjectiveLine(flags), 'Blue flag home  Red flag TAKEN');
  assert.equal(deriveObjectiveLine(null), '');
  const st = deriveMatchStatus({ mode: 'koth', phase: 'playing', left: 100, ts: [3, 4], obj: hill });
  assert.equal(st.teams, 'Blue 3  Red 4');
  assert.match(st.objective, /^HILL OPEN/);
  assert.equal(deriveMatchStatus({ mode: 'dm', phase: 'playing', left: 100, ts: null, obj: null }).objective, '');
});

test('minimap marks: a hill ring scaled to the map, a base square and a pennant per flag', () => {
  const map = { half: 40, boxes: [] };
  const lay = minimapLayout(map, { x: 0, z: 0, yaw: 0 }, [], 160, { objective: hill });
  assert.equal(lay.marks.length, 1);
  assert.equal(lay.marks[0].kind, 'hill');
  assert.equal(lay.marks[0].r, 10); // 5 m at 2 px per m
  assert.deepEqual([lay.marks[0].x, lay.marks[0].y], [80, 48]);
  const fm = objectiveMarks(flags, (x) => x, (z) => z, 1);
  assert.deepEqual(fm.map((m) => m.kind), ['base', 'base', 'flag', 'flag']);
  assert.equal(fm[3].state, 'carried');
  assert.deepEqual(minimapLayout(map, { x: 0, z: 0 }, [], 160, {}).marks, []);
});
