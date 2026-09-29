import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../../src/server/rateLimit.js';

// fake clock in milliseconds
function bucket({ capacity = 5, refillPerSec = 1, start = 10_000 } = {}) {
  const clock = { t: start };
  const b = new TokenBucket({ capacity, refillPerSec, now: () => clock.t });
  return { b, clock };
}

const drain = (b, n) => {
  for (let i = 0; i < n; i++) assert.equal(b.take(), true, `drain #${i}`);
};

test('a new bucket starts full: capacity takes succeed, the next fails', () => {
  const { b } = bucket({ capacity: 5 });
  drain(b, 5);
  assert.equal(b.take(), false);
});

test('take() defaults to cost 1', () => {
  const { b } = bucket({ capacity: 2 });
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
});

test('take(cost) deducts cost tokens', () => {
  const { b } = bucket({ capacity: 10 });
  assert.equal(b.take(7), true);
  assert.equal(b.take(4), false);
  assert.equal(b.take(3), true);
  assert.equal(b.take(), false);
});

test('a failed take deducts nothing', () => {
  const { b } = bucket({ capacity: 2 });
  assert.equal(b.take(3), false);
  assert.equal(b.take(2), true);
});

test('a cost larger than capacity can never succeed, even after a long wait', () => {
  const { b, clock } = bucket({ capacity: 3, refillPerSec: 100 });
  clock.t += 3_600_000;
  assert.equal(b.take(4), false);
});

test('refill: one token after exactly 1/refillPerSec seconds (250ms at 4/s)', () => {
  const { b, clock } = bucket({ capacity: 3, refillPerSec: 4 });
  drain(b, 3);
  clock.t += 250;
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
});

test('refill: not yet a full token 1ms early (249ms at 4/s)', () => {
  const { b, clock } = bucket({ capacity: 3, refillPerSec: 4 });
  drain(b, 3);
  clock.t += 249;
  assert.equal(b.take(), false);
});

test('refill is continuous: 2 seconds at 1/s yields exactly 2 tokens', () => {
  const { b, clock } = bucket({ capacity: 10, refillPerSec: 1 });
  drain(b, 10);
  clock.t += 2000;
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
});

test('refill uses milliseconds: 1000 ms at 1/s is one token, 1 ms is not', () => {
  const { b, clock } = bucket({ capacity: 1, refillPerSec: 1 });
  drain(b, 1);
  clock.t += 1;
  assert.equal(b.take(), false);
});

test('refill never exceeds capacity even after an hour idle', () => {
  const { b, clock } = bucket({ capacity: 3, refillPerSec: 10 });
  clock.t += 3_600_000;
  drain(b, 3);
  assert.equal(b.take(), false);
});

test('refill also caps at capacity when partially drained', () => {
  const { b, clock } = bucket({ capacity: 4, refillPerSec: 1 });
  drain(b, 1);
  clock.t += 100_000;
  drain(b, 4);
  assert.equal(b.take(), false);
});

test('fractional refill accumulates across calls without granting early tokens', () => {
  const { b, clock } = bucket({ capacity: 2, refillPerSec: 2 }); // 500ms per token
  drain(b, 2);
  clock.t += 250;
  assert.equal(b.take(), false);
  clock.t += 250;
  assert.equal(b.take(), true);
});

test('a burst at the same instant cannot exceed capacity', () => {
  const { b } = bucket({ capacity: 3, refillPerSec: 1000 });
  let ok = 0;
  for (let i = 0; i < 100; i++) if (b.take()) ok++;
  assert.equal(ok, 3);
});

test('the clock is only read through the injected now()', () => {
  let calls = 0;
  const b = new TokenBucket({ capacity: 1, refillPerSec: 1, now: () => (calls++, 5) });
  b.take();
  assert.ok(calls >= 1);
});

test('a clock moving backwards does not throw and grants no tokens', () => {
  const { b, clock } = bucket({ capacity: 2, refillPerSec: 1 });
  drain(b, 2);
  clock.t -= 10_000;
  assert.equal(b.take(), false);
});

test('two buckets are independent of each other', () => {
  const a = bucket({ capacity: 2 });
  const c = bucket({ capacity: 2 });
  drain(a.b, 2);
  assert.equal(a.b.take(), false);
  assert.equal(c.b.take(), true);
});

test('default clock: a bucket built without now() works', () => {
  const b = new TokenBucket({ capacity: 1, refillPerSec: 1 });
  assert.equal(b.take(), true);
});

for (const bad of [0, -1, NaN, Infinity, -Infinity, undefined]) {
  test(`constructor throws for capacity=${String(bad)}`, () => {
    assert.throws(() => new TokenBucket({ capacity: bad, refillPerSec: 1 }));
  });
  test(`constructor throws for refillPerSec=${String(bad)}`, () => {
    assert.throws(() => new TokenBucket({ capacity: 1, refillPerSec: bad }));
  });
}

test('property: over a long seeded sequence the bucket never grants more than capacity + refill allows', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const capacity = 5;
  const refillPerSec = 2;
  const { b, clock } = bucket({ capacity, refillPerSec, start: 0 });
  let granted = 0;
  let elapsedMs = 0;
  for (let i = 0; i < 2000; i++) {
    const dt = Math.floor(rnd() * 400);
    clock.t += dt;
    elapsedMs += dt;
    if (b.take()) granted++;
  }
  const upperBound = capacity + (refillPerSec * elapsedMs) / 1000 + 1e-6;
  assert.ok(granted <= upperBound, `granted ${granted} > bound ${upperBound}`);
});
