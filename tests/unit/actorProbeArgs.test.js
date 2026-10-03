import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, summarize } from '../../scripts/actor-probe.mjs';

// The probe script talks to a live app, so only its pure parts run here: argument parsing and the summary.

const APP = '6ac103381bbc9fd85fefcb78';

test('actor-probe: defaults and flags', () => {
  assert.deepEqual(parseArgs([APP]), { appId: APP, room: 'probe-1', seconds: 8, inputs: false, diag: false, ping: false, proxy: false });
  const a = parseArgs(['--diag', APP, 'room_x', '3', '--inputs']);
  assert.equal(a.room, 'room_x');
  assert.equal(a.seconds, 3);
  assert.equal(a.inputs, true);
  assert.equal(a.diag, true);
  assert.equal(a.proxy, false);
});

test('actor-probe: usage errors', () => {
  assert.match(parseArgs([]).error, /app-id/);
  assert.match(parseArgs(['not-an-id']).error, /app-id/);
  assert.match(parseArgs([APP, 'bad room!']).error, /room/);
  assert.match(parseArgs([APP, 'r', '0']).error, /seconds/);
  assert.match(parseArgs([APP, 'r', '5', '--bogus']).error, /unknown flag/);
});

test('actor-probe: summary counts snapshots and gap percentiles', () => {
  const s = summarize({ counts: { welcome: 1, snap: 4 }, snapTimes: [0, 33, 67, 100], seconds: 2 });
  assert.equal(s.snaps, 4);
  assert.equal(s.snapsPerSec, 2);
  assert.deepEqual(s.gapMs, { p50: 33, p90: 34, max: 34 }, 'gaps 33, 34, 33 sorted: 33, 33, 34');
  assert.deepEqual(summarize({ counts: {}, snapTimes: [], seconds: 1 }).gapMs, { p50: null, p90: null, max: null });
});

test('actor-probe: --ping flag (SPEC 18.2)', () => {
  assert.equal(parseArgs([APP]).ping, false);
  assert.equal(parseArgs([APP, 'r', '5', '--ping']).ping, true);
  const s = summarize({ counts: { snap: 2 }, snapTimes: [0, 33], seconds: 1, pongs: 3, rtts: [30, 40, 90], clockOffset: 12.5 });
  assert.equal(s.pongs, 3);
  assert.deepEqual(s.rttMs, { p50: 40, max: 90 });
  assert.equal(s.clockOffsetMs, 12.5);
});
