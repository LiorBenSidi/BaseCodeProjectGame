import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/server/logger.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXED = () => new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678));

function make(name = 'game', opts = {}) {
  const lines = [];
  const log = createLogger(name, { sink: (l) => lines.push(l), now: FIXED, ...opts });
  return { log, lines };
}

test('info writes one JSON line with ts, level, logger and msg', () => {
  const { log, lines } = make();
  log.info('hello');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    ts: '2026-01-02T03:04:05.678Z',
    level: 'info',
    logger: 'game',
    msg: 'hello',
  });
});

test('the sink receives a single string argument', () => {
  const calls = [];
  const log = createLogger('x', { sink: (...args) => calls.push(args), now: FIXED });
  log.info('m');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(typeof calls[0][0], 'string');
});

test('extra fields are merged into the JSON object', () => {
  const { log, lines } = make();
  log.info('joined', { id: 7, name: 'Bob' });
  const o = JSON.parse(lines[0]);
  assert.equal(o.id, 7);
  assert.equal(o.name, 'Bob');
  assert.equal(o.msg, 'joined');
});

test('each level method reports its own level name', () => {
  const { log, lines } = make('g', { level: 'debug' });
  log.debug('a');
  log.info('b');
  log.warn('c');
  log.error('d');
  assert.deepEqual(lines.map((l) => JSON.parse(l).level), ['debug', 'info', 'warn', 'error']);
});

test('ts comes from now() at call time (ISO-8601)', () => {
  let n = 0;
  const lines = [];
  const log = createLogger('g', {
    sink: (l) => lines.push(l),
    now: () => new Date(Date.UTC(2026, 5, 1, 0, 0, n++)),
  });
  log.info('a');
  log.info('b');
  assert.equal(JSON.parse(lines[0]).ts, '2026-06-01T00:00:00.000Z');
  assert.equal(JSON.parse(lines[1]).ts, '2026-06-01T00:00:01.000Z');
});

test('logger field carries the name given to createLogger', () => {
  const { log, lines } = make('room-7');
  log.info('x');
  assert.equal(JSON.parse(lines[0]).logger, 'room-7');
});

test('default level is info: debug is suppressed, info is emitted', () => {
  const { log, lines } = make();
  log.debug('no');
  assert.equal(lines.length, 0);
  log.info('yes');
  assert.equal(lines.length, 1);
});

// level matrix: configured level -> which methods emit
const ORDER = ['debug', 'info', 'warn', 'error'];
for (const [i, configured] of ORDER.entries()) {
  for (const [j, method] of ORDER.entries()) {
    const shouldEmit = j >= i;
    test(`level=${configured}: ${method}() ${shouldEmit ? 'emits' : 'does nothing (sink not called)'}`, () => {
      const { log, lines } = make('g', { level: configured });
      log[method]('m');
      assert.equal(lines.length, shouldEmit ? 1 : 0);
    });
  }
}

for (const bad of ['verbose', 'trace', '', 'fatal', 42, {}]) {
  test(`invalid level ${JSON.stringify(bad)} throws`, () => {
    assert.throws(() => createLogger('g', { level: bad, sink: () => {}, now: FIXED }));
  });
}

test('reserved keys in fields never override ts, level, logger, msg', () => {
  const { log, lines } = make();
  log.info('real', { ts: 'fake', level: 'fake', logger: 'fake', msg: 'fake', keep: 1 });
  const o = JSON.parse(lines[0]);
  assert.equal(o.ts, '2026-01-02T03:04:05.678Z');
  assert.equal(o.level, 'info');
  assert.equal(o.logger, 'game');
  assert.equal(o.msg, 'real');
  assert.equal(o.keep, 1);
});

test('the caller-supplied fields object is not mutated', () => {
  const { log } = make();
  const f = { ts: 'x', msg: 'y', a: 1 };
  log.info('m', f);
  assert.deepEqual(f, { ts: 'x', msg: 'y', a: 1 });
});

test('with no fields the object has exactly the four base keys', () => {
  const { log, lines } = make();
  log.warn('m');
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['level', 'logger', 'msg', 'ts']);
});

test('an err field holding an Error is serialized as { name, message } only', () => {
  const { log, lines } = make();
  log.error('failed', { err: new TypeError('boom') });
  const o = JSON.parse(lines[0]);
  assert.deepEqual(o.err, { name: 'TypeError', message: 'boom' });
});

test('an Error carries no stack and no extra own properties into the log', () => {
  const { log, lines } = make();
  const e = new Error('x');
  e.code = 'E_SECRET';
  e.token = 'hunter2';
  log.error('failed', { err: e });
  const o = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(o.err).sort(), ['message', 'name']);
  assert.ok(!lines[0].includes('hunter2'));
  assert.ok(!lines[0].includes('logger.test.js'), 'stack frames leaked');
});

test('an Error with a multi-line message stays on one line', () => {
  const { log, lines } = make();
  log.error('failed', { err: new Error('line1\nline2\r\nline3') });
  assert.equal(lines.length, 1);
  assert.ok(!/[\r\n]/.test(lines[0]));
  assert.equal(JSON.parse(lines[0]).err.message, 'line1\nline2\r\nline3');
});

test('newlines in msg cannot break the one-line format', () => {
  const { log, lines } = make();
  log.info('a\nb\rc');
  assert.equal(lines.length, 1);
  assert.ok(!/[\r\n]/.test(lines[0]));
  assert.equal(JSON.parse(lines[0]).msg, 'a\nb\rc');
});

test('log forging: a msg embedding a fake JSON log line yields exactly one line/event', () => {
  const { log, lines } = make();
  log.info('user said hi\n{"ts":"x","level":"error","logger":"game","msg":"FORGED"}');
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('\n'));
  assert.equal(JSON.parse(lines[0]).level, 'info');
});

test('newlines and control chars in field values cannot break the format', () => {
  const { log, lines } = make();
  log.info('m', { name: 'evil\nname\u0000\u001b[31m', nested: { a: ['x\ny'] } });
  assert.equal(lines.length, 1);
  assert.ok(!/[\u0000-\u001f]/.test(lines[0]));
  assert.equal(JSON.parse(lines[0]).name, 'evil\nname\u0000\u001b[31m');
});

test('newlines in field keys cannot break the format', () => {
  const { log, lines } = make();
  log.info('m', { 'k\ney': 1 });
  assert.equal(lines.length, 1);
  assert.ok(!/[\u0000-\u001f]/.test(lines[0]));
});

test('the sink line does not end with a newline (the sink adds it)', () => {
  const { log, lines } = make();
  log.info('m');
  assert.ok(!lines[0].endsWith('\n'));
});

test('property: random hostile msg/field content always yields exactly one parseable control-char-free line', () => {
  const rnd = mulberry32(1337);
  for (let i = 0; i < 500; i++) {
    let s = '';
    const len = Math.floor(rnd() * 40);
    for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(rnd() * 0x80) % (rnd() < 0.5 ? 0x20 : 0x80));
    const { log, lines } = make('g', { level: 'debug' });
    log.info(s, { a: s, [s]: s, err: new Error(s), ts: s, level: s });
    assert.equal(lines.length, 1);
    assert.ok(!/[\u0000-\u001f]/.test(lines[0]), `control char in output for iteration ${i}`);
    const o = JSON.parse(lines[0]);
    assert.equal(o.level, 'info');
    assert.equal(o.logger, 'g');
  }
});

test('two loggers with different names and sinks do not interfere', () => {
  const a = make('A');
  const b = make('B');
  a.log.info('x');
  assert.equal(a.lines.length, 1);
  assert.equal(b.lines.length, 0);
  b.log.info('y');
  assert.equal(JSON.parse(b.lines[0]).logger, 'B');
});
