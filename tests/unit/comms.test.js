// SPEC 39.8: ping wheel rules, server relay and the client's pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARK_KINDS, WHEEL_ORDER, sanitizeMark, wheelPick, quickKind, addMark, pruneMarks, markFeedText, MARK_MAX_LIVE, MARK_MIN_INTERVAL_MS } from '../../src/shared/comms.js';
import { parseClientMessage } from '../../src/server/protocol.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { minimapLayout } from '../../src/client/ceremony.js';

test('wheel: eight kinds clockwise from the top, dead zone picks nothing, quick kind by aim', () => {
  assert.equal(WHEEL_ORDER.length, 8);
  for (const id of WHEEL_ORDER) assert.ok(MARK_KINDS[id]);
  assert.equal(wheelPick(0, 0), null);
  assert.equal(wheelPick(5, -5), null, 'inside the dead zone');
  assert.equal(wheelPick(0, -60), 'go', 'up');
  assert.equal(wheelPick(60, 0), WHEEL_ORDER[2], 'right');
  assert.equal(wheelPick(0, 60), WHEEL_ORDER[4], 'down');
  assert.equal(wheelPick(-60, 0), WHEEL_ORDER[6], 'left');
  assert.equal(quickKind(true), 'enemy');
  assert.equal(quickKind(false), 'watch');
});

test('sanitizeMark rejects junk and rounds; the live list caps per sender and expires', () => {
  assert.equal(sanitizeMark('go', [1, 2]), null);
  assert.equal(sanitizeMark('nope', [1, 2, 3]), null);
  assert.equal(sanitizeMark('go', [500, 0, 0]), null);
  assert.deepEqual(sanitizeMark('go', [1.234, 0, -2.26]), { kind: 'go', at: [1.2, 0, -2.3] });
  const list = [];
  for (let i = 0; i < MARK_MAX_LIVE + 2; i += 1) addMark(list, { from: 1, kind: 'go', pos: [i, 0, 0] }, 1000 + i);
  assert.equal(list.length, MARK_MAX_LIVE, 'oldest replaced');
  assert.equal(list[0].pos[0], 2);
  addMark(list, { from: 2, kind: 'thanks', pos: [9, 0, 0] }, 2000);
  pruneMarks(list, 2000 + MARK_KINDS.thanks.ttlMs);
  assert.equal(list.find((m) => m.from === 2), undefined, 'thanks expired');
  assert.equal(markFeedText('Ace', 'danger'), 'Ace: Danger here');
});

test('protocol: mark parses, server relays to the team only, rate limited', () => {
  const r = parseClientMessage(JSON.stringify({ t: 'mark', kind: 'go', at: [1, 0, 2] }));
  assert.equal(r.ok, true);
  assert.equal(parseClientMessage(JSON.stringify({ t: 'mark', kind: 'go', at: [1, 'x', 2] })).ok, false);
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, mode: 'tdm', botFill: 0 });
  const boxes = [[], [], []];
  const [a, b, c] = boxes.map((box, i) => room.addPlayer({ send: (m) => box.push(m), name: `P${i}` }));
  const marksOf = (box) => box.filter((m) => m.t === 'mark');
  assert.ok(room.handleMark(a.id, 'danger', [3, 0, 4]));
  const ally = a.team === c.team ? c : b, enemy = a.team === c.team ? b : c;
  const allyBox = boxes[[a, b, c].indexOf(ally)], enemyBox = boxes[[a, b, c].indexOf(enemy)];
  assert.equal(marksOf(boxes[0]).length, 1, 'sender hears its own mark');
  assert.equal(marksOf(allyBox).length, 1);
  assert.equal(marksOf(enemyBox).length, 0, 'enemies never see it');
  assert.deepEqual(marksOf(boxes[0])[0].at, [3, 0, 4]);
  assert.equal(room.handleMark(a.id, 'go', [0, 0, 0]), false, 'too soon');
  clock.t += MARK_MIN_INTERVAL_MS;
  assert.equal(room.handleMark(a.id, 'go', [0, 0, 0]), true);
  assert.equal(room.handleMark(a.id, 'nope', [0, 0, 0]), false);
  for (const p of [a, b, c]) room.removePlayer(p.id);
});

test('minimap draws a cross per live ping', () => {
  const lay = minimapLayout({ half: 40, boxes: [] }, { x: 0, z: 0 }, [], 160, { pings: [{ from: 1, kind: 'go', pos: [0, 0, 0] }] });
  assert.deepEqual(lay.marks, [{ kind: 'ping', x: 80, y: 80, color: MARK_KINDS.go.color }]);
});
