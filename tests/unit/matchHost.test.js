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

// ---- hook error reporting (entry.ts guards call fail) ------------------------------------------

test('fail logs the error and sends a bare internal-error frame without diagnostics', () => {
  const lines = [];
  const h = new MatchHost({ sink: (l) => lines.push(JSON.parse(l)), now: () => 1_000_000 });
  const c = actorConn('a');
  h.fail('message', new TypeError('boom'), c);
  assert.deepEqual(c.sent, [{ t: 'error', reason: 'internal', hook: 'message' }], 'no name or message leaks');
  const log = lines.find((l) => l.msg === 'hook threw');
  assert.ok(log, 'the error is logged');
  assert.equal(log.level, 'error');
  assert.equal(log.hook, 'message');
  assert.deepEqual(log.err, { name: 'TypeError', message: 'boom' });
  assert.equal(log.stack, undefined, 'no stack without diagnostics');
});

test('fail adds the error name and message to the frame only when diagnostics are on', () => {
  const lines = [];
  const h = new MatchHost({ sink: (l) => lines.push(JSON.parse(l)), now: () => 1_000_000, diag: true });
  const c = actorConn('a');
  h.fail('schedule', new RangeError('no alarm'), c);
  assert.deepEqual(c.sent, [{ t: 'error', reason: 'internal', hook: 'schedule', name: 'RangeError', message: 'no alarm' }]);
  const log = lines.find((l) => l.msg === 'hook threw');
  assert.ok(typeof log.stack === 'string' && log.stack.includes('no alarm'), 'stack is logged with diagnostics');
});

test('fail copes with no connection, a non-Error value and a throwing socket', () => {
  const h = new MatchHost({ sink: () => {}, now: () => 1_000_000, diag: true });
  assert.doesNotThrow(() => h.fail('tick', 'plain string', undefined));
  assert.doesNotThrow(() => h.fail('close', null, { id: 'x' }), 'conn without send');
  const bad = { id: 'b', send: () => { throw new Error('socket closed'); } };
  assert.doesNotThrow(() => h.fail('message', new Error('x'), bad));
  const c = actorConn('c');
  h.fail('message', 'plain string', c);
  assert.deepEqual(c.sent, [{ t: 'error', reason: 'internal', hook: 'message', name: 'Error', message: 'plain string' }]);
});

test('diag is strictly opt-in: only the boolean true enables it', () => {
  for (const v of ['1', 1, 'true', undefined, null]) {
    const h = new MatchHost({ sink: () => {}, now: () => 1_000_000, diag: v });
    const c = actorConn('a');
    h.fail('message', new Error('secret detail'), c);
    assert.equal(c.sent[0].message, undefined, `diag=${JSON.stringify(v)} must not leak`);
  }
});

// ---- clock precision (SPEC 17.3): the deployed object reads an epoch-size Date.now(), where a double keeps
// about 0.0002 ms, so the arithmetic must only ever divide a small difference of two readings.

const EPOCH_NOW = 1_759_510_985_616; // 2026-10-03T17:03:05.616Z, the reading that lost the first step

test('a join at an epoch-size wall clock still runs the first step at once', () => {
  const { h, clock } = clockHost(EPOCH_NOW);
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  assert.equal(snaps(c), 1, 'the first snapshot leaves with the welcome at a real clock too');
  assert.equal(h.advance(), 0, 'no wall time passed, no step');
  clock.t += 34; // one whole millisecond past TICK_MS, as a real clock would read
  assert.equal(h.advance(), 1);
  clock.t += 100;
  assert.equal(h.advance(), 3, 'at most MAX_CATCHUP per event');
});

test('the first step survives a sweep of epoch-size clock readings', () => {
  for (let i = 0; i < 200; i++) {
    const t0 = EPOCH_NOW + i * 7919;
    const { h } = clockHost(t0);
    const c = actorConn('a');
    h.connect(c);
    h.message(c, { t: 'join', name: 'Ada' });
    assert.equal(snaps(c), 1, `first step lost at now=${t0}`);
  }
});

test('a steady 60 Hz input stream at an epoch-size clock runs 30 steps per second', () => {
  const { h, clock } = clockHost(EPOCH_NOW);
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  let seq = 0;
  for (let i = 1; i <= 60; i++) {
    clock.t = EPOCH_NOW + Math.round((i * 1000) / 60);
    h.message(c, { t: 'input', cmds: [{ seq: ++seq, fwd: 1, right: 0, jump: false, yaw: 0, pitch: 0 }] });
  }
  const n = snaps(c);
  assert.ok(n >= 30 && n <= 31, `expected about 30 snapshots in one second, got ${n}`);
});

// ---- diagnostic probe (SPEC 17.3): opt-in clock internals for a live object nobody can attach a debugger to.

test('probe answers { t: "diag" } with the clock state only while diagnostics are on', () => {
  const lines = [];
  const h = new MatchHost({ sink: (l) => lines.push(JSON.parse(l)), now: () => EPOCH_NOW, diag: true });
  const c = actorConn('a');
  h.connect(c);
  assert.equal(h.probe(c, { t: 'diag' }, { hooks: { connect: 1 }, clockArmed: false }), true);
  assert.equal(c.sent.length, 1);
  const d = c.sent[0];
  assert.equal(d.t, 'diag');
  assert.equal(d.now, EPOCH_NOW);
  assert.equal(d.anchorAt, null, 'nobody seated, no anchor');
  assert.equal(d.stepsSinceAnchor, 0);
  assert.equal(d.tickMs, TICK_MS);
  assert.equal(d.maxCatchup, 3);
  assert.equal(d.playerCount, 0);
  assert.equal(d.lastFail, null);
  assert.deepEqual(d.hooks, { connect: 1 });
  assert.equal(d.clockArmed, false);

  h.message(c, { t: 'join', name: 'Ada' });
  h.fail('wake', new RangeError('no alarm'), undefined);
  assert.equal(h.probe(c, { t: 'diag' }, {}), true);
  const d2 = c.sent.at(-1);
  assert.equal(d2.anchorAt, EPOCH_NOW, 'the anchor is the wall time of the first step');
  assert.equal(d2.stepsSinceAnchor, 0, 'the first step has run');
  assert.equal(d2.playerCount, 1);
  assert.deepEqual(d2.lastFail, { hook: 'wake', name: 'RangeError', message: 'no alarm', at: EPOCH_NOW });
  assert.equal(snaps(c), 1, 'a probe never advances the clock');
});

test('probe ignores other messages and is inert without diagnostics', () => {
  const on = new MatchHost({ sink: () => {}, now: () => EPOCH_NOW, diag: true });
  const c = actorConn('a');
  on.connect(c);
  assert.equal(on.probe(c, { t: 'join', name: 'Ada' }, {}), false);
  assert.equal(on.probe(c, 'diag', {}), false);
  assert.equal(on.probe(c, null, {}), false);
  assert.equal(c.sent.length, 0);

  const lines = [];
  const off = new MatchHost({ sink: (l) => lines.push(JSON.parse(l)), now: () => EPOCH_NOW, logLevel: 'debug' });
  const d = actorConn('d');
  off.connect(d);
  assert.equal(off.probe(d, { t: 'diag' }, {}), false, 'with the secret unset the message is not special');
  off.message(d, { t: 'diag' });
  assert.equal(d.sent.length, 0, 'nothing is answered');
  const strike = lines.find((l) => l.msg === 'bad client message');
  assert.ok(strike, 'and it earns the usual protocol strike');
  assert.equal(strike.reason, 'bad_shape');
});
