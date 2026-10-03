// MatchHost adapts the actor runtime's connection objects to MatchSession and owns the wake
// behaviour. The fake conns here mirror the shim (id, send, reject(code, reason)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchHost, CLOSE_CODES, MAX_CATCHUP, TICK_MS, wrapConn } from '../../base44/actors/Match/matchHost.js';
import { MAX_PLAYERS } from '../../src/shared/constants.js';

function actorConn(id) {
  const c = { id, sent: [], rejected: null };
  c.send = (data) => c.sent.push(data);
  c.reject = (code, reason) => { c.rejected = { code, reason }; };
  return c;
}

const host = () => new MatchHost({ sink: () => {}, now: () => 1_000_000 });

test('close codes are in the application range Cloudflare accepts (1000 or 3000-4999)', () => {
  for (const code of Object.values(CLOSE_CODES)) {
    assert.ok(code === 1000 || (code >= 3000 && code <= 4999), `code ${code}`);
  }
});

test('wrapConn maps a session reason to reject(code, reason)', () => {
  const c = actorConn('a');
  const w = wrapConn(c);
  w.send({ t: 'x' });
  w.close('room_full');
  assert.deepEqual(c.sent, [{ t: 'x' }]);
  assert.deepEqual(c.rejected, { code: CLOSE_CODES.room_full, reason: 'room_full' });
  w.close('unknown_reason');
  assert.equal(c.rejected.code, 4000);
});

test('shouldTick is false for an empty room and true once a player joined', () => {
  const h = host();
  assert.equal(h.shouldTick(), false);
  const c = actorConn('a');
  h.connect(c);
  assert.equal(h.shouldTick(), false, 'a connection without a seat does not start the loop');
  h.message(c, { t: 'join', name: 'Ada' });
  assert.equal(h.shouldTick(), true);
  h.close(c);
  assert.equal(h.shouldTick(), false);
});

test('tick produces a snapshot for the joined player', () => {
  const h = host();
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  h.tick();
  assert.ok(c.sent.some((m) => m.t === 'snap'));
});

test('a cold wake with no sockets does nothing; a hibernation wake asks attached sockets to rejoin', () => {
  const h = host();
  assert.equal(h.wake([]), 0);
  const a = actorConn('a');
  const b = actorConn('b');
  assert.equal(h.wake([a, b]), 2);
  assert.deepEqual(a.sent, [{ t: 'rejoin' }]);
  assert.deepEqual(b.sent, [{ t: 'rejoin' }]);
  h.message(a, { t: 'join', name: 'A' });
  assert.equal(h.shouldTick(), true);
  assert.equal(h.session.connectionCount, 2);
});

test('wake does not duplicate a connection that is already registered', () => {
  const h = host();
  const a = actorConn('a');
  h.connect(a);
  h.message(a, { t: 'join', name: 'A' });
  assert.equal(h.wake([a]), 0, 'seated connection is not asked to rejoin');
  assert.equal(h.session.connectionCount, 1);
});

test('room full through the actor path rejects with 4013', () => {
  const h = host();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const c = actorConn(`p${i}`);
    h.connect(c);
    h.message(c, { t: 'join', name: `P${i}` });
  }
  const extra = actorConn('extra');
  h.connect(extra);
  h.message(extra, { t: 'join', name: 'Late' });
  assert.deepEqual(extra.rejected, { code: 4013, reason: 'room_full' });
});

test('hostile messages through the actor path strike and reject with 4008', () => {
  const h = host();
  const c = actorConn('a');
  h.connect(c);
  for (let i = 0; i < 5; i++) h.message(c, { t: 'hp', value: 999 });
  assert.deepEqual(c.rejected, { code: 4008, reason: 'protocol_violations' });
});

// ---- event-driven clock (SPEC 17.3): the deployed actor gets no timer, so wall time is sampled on every
// event and the steps that are due run then, bounded like the platform's own TickLoop (3, then drop time).

function clockHost(t0 = 1_000_000) {
  const clock = { t: t0 };
  const h = new MatchHost({ sink: () => {}, now: () => clock.t });
  return { h, clock };
}
const snaps = (c) => c.sent.filter((m) => m.t === 'snap').length;

test('a join runs the first step at once and later events run one step per TICK_MS of wall time', () => {
  const { h, clock } = clockHost();
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  assert.equal(snaps(c), 1, 'the first snapshot leaves with the welcome, no wait for a timer');
  assert.equal(h.advance(), 0, 'no wall time passed, no step');
  clock.t += TICK_MS * 2;
  assert.equal(h.advance(), 2);
  assert.equal(snaps(c), 3);
});

test('an input message advances the clock without any managed tick', () => {
  const { h, clock } = clockHost();
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  clock.t += TICK_MS;
  h.message(c, { t: 'input', cmds: [{ seq: 1, fwd: 1, right: 0, jump: false, yaw: 0, pitch: 0 }] });
  assert.equal(snaps(c), 2, 'the step that was due ran inside the message event');
});

test('catch-up after a stall is capped at MAX_CATCHUP and the remaining time is dropped', () => {
  const { h, clock } = clockHost();
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  clock.t += TICK_MS * 10;
  assert.equal(h.advance(), MAX_CATCHUP);
  assert.equal(h.advance(), 0, 'the seven missed steps are dropped, not replayed on the next event');
  clock.t += TICK_MS;
  assert.equal(h.advance(), 1, 'after a drop the clock is re-anchored to the current wall time');
});

test('the managed ticker, if it ever runs, shares the same wall-time gate (no double stepping)', () => {
  const { h, clock } = clockHost();
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  assert.equal(h.tick(), 0);
  clock.t += TICK_MS;
  assert.equal(h.tick(), 1);
});

test('an empty room stops the clock and a new first player does not inherit the old anchor', () => {
  const { h, clock } = clockHost();
  const a = actorConn('a');
  h.connect(a);
  h.message(a, { t: 'join', name: 'Ada' });
  h.close(a);
  clock.t += TICK_MS * 50;
  assert.equal(h.advance(), 0, 'nobody seated, nothing to step');
  const b = actorConn('b');
  h.connect(b);
  h.message(b, { t: 'join', name: 'Bob' });
  assert.equal(snaps(b), 1, 'exactly the immediate first step, not a capped catch-up of the idle time');
});
