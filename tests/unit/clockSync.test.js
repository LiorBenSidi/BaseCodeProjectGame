// ClockSync (docs/SPEC.md section 18.2): the client's estimate of the room clock from ping/pong samples.
// Pure module, driven here with explicit client times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, PING_INTERVAL_MS, PING_TIMEOUT_MS, CLOCK_SAMPLES } from '../../src/client/clockSync.js';

test('constants match the SPEC', () => {
  assert.equal(PING_INTERVAL_MS, 1000);
  assert.equal(PING_TIMEOUT_MS, 5000);
  assert.equal(CLOCK_SAMPLES, 8);
});

test('nextPing: the first call sends, then one ping per interval, ids count up from 0', () => {
  const c = new ClockSync();
  assert.deepEqual(c.nextPing(10_000), { t: 'ping', id: 0, ts: 10_000 });
  assert.equal(c.nextPing(10_500), null);
  assert.equal(c.nextPing(10_999), null);
  assert.deepEqual(c.nextPing(11_000), { t: 'ping', id: 1, ts: 11_000 });
  assert.deepEqual(c.nextPing(12_300), { t: 'ping', id: 2, ts: 12_300 });
});

test('onPong: rtt and offset from the echoed stamp and the server now', () => {
  const c = new ClockSync();
  const ping = c.nextPing(10_000);
  assert.equal(c.synced, false);
  assert.equal(c.serverTime(10_000), null);
  // The answer arrives 40 ms later; the server read 500_000 when it answered (half-way).
  const sample = c.onPong({ t: 'pong', id: ping.id, ts: ping.ts, now: 500_000 }, 10_040);
  assert.deepEqual(sample, { rtt: 40, offset: 500_000 + 20 - 10_040 });
  assert.equal(c.synced, true);
  assert.equal(c.rtt, 40);
  assert.equal(c.offset, 489_980);
  assert.equal(c.serverTime(10_040), 500_020);
  assert.equal(c.jitter, 0);
});

test('onPong: unknown id, wrong ts, duplicate and malformed pongs are ignored', () => {
  const c = new ClockSync();
  const ping = c.nextPing(10_000);
  assert.equal(c.onPong({ t: 'pong', id: 7, ts: ping.ts, now: 1 }, 10_010), null);
  assert.equal(c.onPong({ t: 'pong', id: ping.id, ts: ping.ts + 1, now: 1 }, 10_010), null);
  assert.equal(c.onPong({ t: 'pong', id: ping.id, ts: ping.ts, now: 'soon' }, 10_010), null);
  assert.equal(c.onPong(null, 10_010), null);
  assert.equal(c.onPong({ t: 'pong', id: ping.id, ts: ping.ts, now: NaN }, 10_010), null);
  assert.equal(c.synced, false);
  assert.ok(c.onPong({ t: 'pong', id: ping.id, ts: ping.ts, now: 1 }, 10_010));
  // The same pong again: no longer outstanding.
  assert.equal(c.onPong({ t: 'pong', id: ping.id, ts: ping.ts, now: 1 }, 10_020), null);
  assert.equal(c.stats().samples, 1);
});

test('onPong: a pong older than the timeout is forgotten', () => {
  const c = new ClockSync();
  const ping = c.nextPing(10_000);
  c.nextPing(10_000 + PING_TIMEOUT_MS + 1); // the sweep happens when the next ping is prepared
  assert.equal(c.onPong({ t: 'pong', id: ping.id, ts: ping.ts, now: 1 }, 10_000 + PING_TIMEOUT_MS + 2), null);
});

test('offset comes from the lowest-RTT sample, rtt from the latest, jitter from the spread', () => {
  const c = new ClockSync();
  const answer = (sentAt, rtt, serverNow) => {
    const p = c.nextPing(sentAt);
    assert.ok(p, `ping due at ${sentAt}`);
    return c.onPong({ t: 'pong', id: p.id, ts: p.ts, now: serverNow }, sentAt + rtt);
  };
  // Server clock runs exactly 1_000_000 ahead of the client. Clean sample: rtt 30.
  answer(10_000, 30, 1_010_015);
  // Queued sample: the reply was delayed on the way back, so the midpoint estimate is 100 ms off.
  answer(11_000, 230, 1_011_015);
  // Another clean sample with slightly higher rtt.
  answer(12_000, 34, 1_012_017);
  assert.equal(c.rtt, 34);
  assert.equal(c.jitter, 200);
  assert.equal(c.offset, 1_000_000, 'the 30 ms sample wins over the smeared 230 ms one');
  assert.equal(c.serverTime(13_000), 1_013_000);
});

test('only the newest CLOCK_SAMPLES samples are kept', () => {
  const c = new ClockSync();
  for (let i = 0; i < CLOCK_SAMPLES + 3; i++) {
    const sentAt = 10_000 + i * 1000;
    const p = c.nextPing(sentAt);
    // The very first sample has the lowest rtt; it must age out.
    const rtt = i === 0 ? 10 : 50 + i;
    c.onPong({ t: 'pong', id: p.id, ts: p.ts, now: sentAt + rtt / 2 }, sentAt + rtt);
  }
  assert.equal(c.stats().samples, CLOCK_SAMPLES);
  assert.equal(c.offset, 0);
  assert.equal(c.jitter, CLOCK_SAMPLES - 1);
});

test('stats exposes rounded display values', () => {
  const c = new ClockSync();
  const p = c.nextPing(10_000);
  c.onPong({ t: 'pong', id: p.id, ts: p.ts, now: 20_000 }, 10_033);
  assert.deepEqual(c.stats(), { rtt: 33, jitter: 0, offset: 9983.5, samples: 1 });
});
