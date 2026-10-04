// SPEC 35.4 (D-032): tutorial steps and contextual tips, pure logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, STEP_IDS, newTutorial, current, advance, progress, shouldStart, markDone, STORAGE_KEY, TIPS, nextTip } from '../../src/client/tutorial.js';

const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('steps advance only on their own action, in order; skip ends it; the last step waits for dismiss', () => {
  const t = newTutorial();
  assert.equal(current(t).id, 'move');
  assert.equal(advance(t, 'hit'), false, 'shooting first does not skip the move step');
  assert.equal(advance(t, 'move'), true);
  assert.equal(current(t).id, 'look');
  assert.deepEqual(progress(t), { index: 2, total: STEPS.length });
  for (const ev of ['look', 'jump', 'slide', 'hit', 'reload', 'switch', 'throw', 'ability']) assert.equal(advance(t, ev), true, ev);
  assert.equal(current(t).id, 'done');
  assert.equal(t.done, false);
  assert.equal(advance(t, 'move'), false);
  assert.equal(advance(t, 'dismiss'), true);
  assert.equal(t.done, true); assert.equal(current(t), null);
  assert.equal(advance(t, 'move'), false, 'finished tutorials ignore everything');
  const s = newTutorial();
  advance(s, 'move');
  assert.equal(advance(s, 'skip'), true); assert.equal(s.done, true);
  assert.equal(new Set(STEP_IDS).size, STEPS.length, 'unique ids');
  for (const st of STEPS) assert.ok(st.title && st.text.length < 90, `${st.id} fits the card`);
});

test('the tutorial starts only in a practice range and only once; tips fire once each in order', () => {
  const st = storage();
  assert.equal(shouldStart('range', st), true);
  assert.equal(shouldStart('dm', st), false);
  markDone(st);
  assert.equal(st.getItem(STORAGE_KEY), '1');
  assert.equal(shouldStart('range', st), false);
  assert.equal(shouldStart('range', undefined), true, 'no storage: still show it');
  const seen = [];
  const a = nextTip('matchStart', seen);
  assert.equal(a.id, 'tip_tab');
  seen.push(a.id);
  assert.equal(nextTip('matchStart', seen), null, 'shown once');
  assert.equal(nextTip('death', seen).id, 'tip_death');
  assert.equal(nextTip('nothing', seen), null);
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
});
