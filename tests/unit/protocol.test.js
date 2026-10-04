import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage, validateClientMessage, MAX_CMDS_PER_MSG } from '../../src/server/protocol.js';

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

const goodCmd = (o = {}) => ({ seq: 0, fwd: 0, right: 0, jump: false, yaw: 0, pitch: 0, ...o });
const input = (cmds) => JSON.stringify({ t: 'input', cmds });
const REASONS = new Set(['too_large', 'bad_json', 'bad_shape', 'bad_join', 'bad_cmd']);

function assertFail(raw, reason) {
  const r = parseClientMessage(raw);
  assert.equal(r.ok, false, `expected failure for ${String(raw).slice(0, 80)}`);
  assert.equal(r.reason, reason);
}

// ---------- constants ----------
test('MAX_CMDS_PER_MSG is exported and equals 8', () => {
  assert.equal(MAX_CMDS_PER_MSG, 8);
});

// ---------- size & json ----------
test('a valid message of exactly 4096 bytes is accepted', () => {
  const head = '{"t":"shoot","p":"';
  const tail = '"}';
  const raw = head + 'a'.repeat(4096 - head.length - tail.length) + tail;
  assert.equal(Buffer.byteLength(raw), 4096);
  assert.equal(parseClientMessage(raw).ok, true);
});

test('a valid JSON message of 4097 bytes is too_large', () => {
  const head = '{"t":"shoot","p":"';
  const tail = '"}';
  const raw = head + 'a'.repeat(4097 - head.length - tail.length) + tail;
  assert.equal(Buffer.byteLength(raw), 4097);
  assertFail(raw, 'too_large');
});

test('size is measured in bytes, not characters (multi-byte string)', () => {
  const raw = '{"t":"shoot","p":"' + 'é'.repeat(2100) + '"}'; // ~2100 chars, ~4200 bytes
  assert.ok(raw.length < 4096 && Buffer.byteLength(raw) > 4096);
  assertFail(raw, 'too_large');
});

test('Buffer input over 4096 bytes is too_large', () => {
  assertFail(Buffer.alloc(5000, 0x61), 'too_large');
});

test('Buffer input holding a valid shoot message is accepted', () => {
  const r = parseClientMessage(Buffer.from('{"t":"shoot"}'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'shoot' });
});

for (const raw of ['', '{', '}', 'nope', '{"t":', '{t:"shoot"}', "{'t':'shoot'}", '{"t":"shoot"} trailing', 'undefined', 'NaN']) {
  test(`malformed JSON ${JSON.stringify(raw)} -> bad_json`, () => {
    assertFail(raw, 'bad_json');
  });
}

test('Buffer with invalid UTF-8/JSON bytes -> bad_json', () => {
  assertFail(Buffer.from([0xff, 0xfe, 0xfd]), 'bad_json');
});

test('empty Buffer -> bad_json', () => {
  assertFail(Buffer.alloc(0), 'bad_json');
});

// ---------- shape ----------
for (const raw of ['null', '[]', '5', '"str"', 'true', '[{"t":"shoot"}]', '{}', '{"t":5}', '{"t":null}', '{"t":["shoot"]}', '{"t":"SHOOT"}', '{"t":"nope"}', '{"t":"__proto__"}', '{"t":"constructor"}', '{"t":"toString"}', '{"t":"hasOwnProperty"}']) {
  test(`shape ${raw} -> bad_shape`, () => {
    assertFail(raw, 'bad_shape');
  });
}

// ---------- join ----------
test('join with a name returns the sanitized name', () => {
  const r = parseClientMessage('{"t":"join","name":"Bob"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'join', name: 'Bob' });
});

test('join without a name yields name ""', () => {
  const r = parseClientMessage('{"t":"join"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'join', name: '' });
});

test('join with a non-string name yields name ""', () => {
  for (const name of [123, null, {}, [], true]) {
    const r = parseClientMessage(JSON.stringify({ t: 'join', name }));
    assert.equal(r.ok, true, `name=${JSON.stringify(name)}`);
    assert.equal(r.msg.name, '');
  }
});

test('join name is sanitized: no markup survives', () => {
  const r = parseClientMessage(JSON.stringify({ t: 'join', name: '<script>alert(1)</script>' }));
  assert.equal(r.ok, true);
  assert.ok(!/[<>]/.test(r.msg.name), r.msg.name);
});

test('join name is truncated to 16 code points', () => {
  const r = parseClientMessage(JSON.stringify({ t: 'join', name: 'x'.repeat(1000) }));
  assert.equal(r.ok, true);
  assert.equal([...r.msg.name].length, 16);
});

test('join drops unknown fields (isAdmin, hp, __proto__)', () => {
  const r = parseClientMessage('{"t":"join","name":"a","isAdmin":true,"hp":9999,"__proto__":{"polluted":1}}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'join', name: 'a' });
  assert.equal(r.msg.isAdmin, undefined);
  assert.equal(r.msg.polluted, undefined);
});

// ---------- shoot ----------
test('shoot is accepted and yields exactly { t: "shoot" }', () => {
  const r = parseClientMessage('{"t":"shoot"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'shoot' });
});

test('shoot drops extra fields', () => {
  const r = parseClientMessage('{"t":"shoot","damage":9999,"isAdmin":true,"target":1}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'shoot' });
});

test('prototype pollution attempt through __proto__ does not pollute Object.prototype', () => {
  parseClientMessage('{"t":"shoot","__proto__":{"isAdmin":true}}');
  parseClientMessage('{"t":"join","__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}');
  assert.equal({}.isAdmin, undefined);
});

test('the returned msg has no inherited attacker-controlled properties', () => {
  const r = parseClientMessage('{"t":"shoot","__proto__":{"isAdmin":true}}');
  assert.equal(r.msg.isAdmin, undefined);
  assert.equal(Object.getPrototypeOf(r.msg), Object.prototype);
});

// ---------- input ----------
test('a valid single-command input message is accepted with all fields preserved', () => {
  const c = goodCmd({ seq: 7, fwd: 1, right: -1, jump: true, yaw: 1.25, pitch: 0.5 });
  const r = parseClientMessage(input([c]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'input', cmds: [{ ...c, sprint: false, crouch: false }] }); // SPEC 23: absent stance flags are false
});

test('SPEC 23: sprint and crouch are coerced to booleans and never anything else', () => {
  const c = goodCmd({ sprint: 1, crouch: 'yes' });
  const r = parseClientMessage(input([c]));
  assert.equal(r.msg.cmds[0].sprint, true);
  assert.equal(r.msg.cmds[0].crouch, true);
  const z = parseClientMessage(input([goodCmd({ sprint: 0, crouch: null })]));
  assert.equal(z.msg.cmds[0].sprint, false);
  assert.equal(z.msg.cmds[0].crouch, false);
});

test('input commands preserve order', () => {
  const cmds = [goodCmd({ seq: 1 }), goodCmd({ seq: 2 }), goodCmd({ seq: 3 })];
  const r = parseClientMessage(input(cmds));
  assert.deepEqual(r.msg.cmds.map((c) => c.seq), [1, 2, 3]);
});

test('exactly MAX_CMDS_PER_MSG (8) commands are accepted', () => {
  const cmds = Array.from({ length: 8 }, (_, i) => goodCmd({ seq: i }));
  const r = parseClientMessage(input(cmds));
  assert.equal(r.ok, true);
  assert.equal(r.msg.cmds.length, 8);
});

test('9 commands -> bad_cmd', () => {
  assertFail(input(Array.from({ length: 9 }, (_, i) => goodCmd({ seq: i }))), 'bad_cmd');
});

test('empty cmds array -> bad_cmd', () => {
  assertFail(input([]), 'bad_cmd');
});

for (const cmds of [null, 'abc', 5, {}, { length: 1, 0: {} }, true]) {
  test(`non-array cmds ${JSON.stringify(cmds)} -> bad_cmd`, () => {
    assertFail(JSON.stringify({ t: 'input', cmds }), 'bad_cmd');
  });
}

test('missing cmds -> bad_cmd', () => {
  assertFail('{"t":"input"}', 'bad_cmd');
});

test('one bad command rejects the whole message', () => {
  const cmds = [goodCmd({ seq: 1 }), goodCmd({ seq: 2, fwd: 'x' }), goodCmd({ seq: 3 })];
  assertFail(input(cmds), 'bad_cmd');
});

for (const el of [null, 5, 'cmd', [], [1, 2], true]) {
  test(`non-object command element ${JSON.stringify(el)} -> bad_cmd`, () => {
    assertFail(input([el]), 'bad_cmd');
  });
}

// seq
for (const seq of [-1, 1.5, '1', null, true, [], {}, 2 ** 53]) {
  test(`seq ${JSON.stringify(seq)} -> bad_cmd`, () => {
    assertFail(input([goodCmd({ seq })]), 'bad_cmd');
  });
}

test('missing seq -> bad_cmd', () => {
  const c = goodCmd();
  delete c.seq;
  assertFail(input([c]), 'bad_cmd');
});

test('seq 0 is valid', () => {
  assert.equal(parseClientMessage(input([goodCmd({ seq: 0 })])).ok, true);
});

test('seq Number.MAX_SAFE_INTEGER is valid, one above is not', () => {
  assert.equal(parseClientMessage(`{"t":"input","cmds":[{"seq":${Number.MAX_SAFE_INTEGER},"fwd":0,"right":0,"yaw":0,"pitch":0}]}`).ok, true);
  assertFail(`{"t":"input","cmds":[{"seq":${Number.MAX_SAFE_INTEGER + 1},"fwd":0,"right":0,"yaw":0,"pitch":0}]}`, 'bad_cmd');
});

test('seq 1e999 (JSON overflow to Infinity) -> bad_cmd', () => {
  assertFail('{"t":"input","cmds":[{"seq":1e999,"fwd":0,"right":0,"yaw":0,"pitch":0}]}', 'bad_cmd');
});

// fwd / right / yaw / pitch validity
for (const field of ['fwd', 'right', 'yaw', 'pitch']) {
  for (const bad of ['1', null, true, [], {}, 'NaN']) {
    test(`${field}=${JSON.stringify(bad)} (non-number) -> bad_cmd`, () => {
      assertFail(input([goodCmd({ [field]: bad })]), 'bad_cmd');
    });
  }
  test(`${field} missing -> bad_cmd`, () => {
    const c = goodCmd();
    delete c[field];
    assertFail(input([c]), 'bad_cmd');
  });
  test(`${field}=1e999 (Infinity) -> bad_cmd`, () => {
    const c = JSON.stringify(goodCmd()).replace(`"${field}":0`, `"${field}":1e999`);
    assertFail(`{"t":"input","cmds":[${c}]}`, 'bad_cmd');
  });
  test(`${field}=-1e999 (-Infinity) -> bad_cmd`, () => {
    const c = JSON.stringify(goodCmd()).replace(`"${field}":0`, `"${field}":-1e999`);
    assertFail(`{"t":"input","cmds":[${c}]}`, 'bad_cmd');
  });
}

test('fwd above 1 is clamped to 1, below -1 clamped to -1', () => {
  const hi = parseClientMessage(input([goodCmd({ fwd: 5 })])).msg.cmds[0];
  const lo = parseClientMessage(input([goodCmd({ fwd: -9e9 })])).msg.cmds[0];
  assert.equal(hi.fwd, 1);
  assert.equal(lo.fwd, -1);
});

test('right above 1 is clamped to 1, below -1 clamped to -1', () => {
  const hi = parseClientMessage(input([goodCmd({ right: 1.0001 })])).msg.cmds[0];
  const lo = parseClientMessage(input([goodCmd({ right: -2 })])).msg.cmds[0];
  assert.equal(hi.right, 1);
  assert.equal(lo.right, -1);
});

test('fwd/right inside [-1,1] are preserved exactly', () => {
  const c = parseClientMessage(input([goodCmd({ fwd: 0.25, right: -0.75 })])).msg.cmds[0];
  assert.equal(c.fwd, 0.25);
  assert.equal(c.right, -0.75);
});

test('yaw is NOT clamped (large values pass through)', () => {
  const c = parseClientMessage(input([goodCmd({ yaw: 12345.5 })])).msg.cmds[0];
  assert.equal(c.yaw, 12345.5);
  const n = parseClientMessage(input([goodCmd({ yaw: -99.25 })])).msg.cmds[0];
  assert.equal(n.yaw, -99.25);
});

test('pitch is clamped into [-1.5533, 1.5533]', () => {
  const hi = parseClientMessage(input([goodCmd({ pitch: 3 })])).msg.cmds[0];
  const lo = parseClientMessage(input([goodCmd({ pitch: -3 })])).msg.cmds[0];
  assert.equal(hi.pitch, 1.5533);
  assert.equal(lo.pitch, -1.5533);
});

test('pitch inside the range is preserved', () => {
  const c = parseClientMessage(input([goodCmd({ pitch: 1.5 })])).msg.cmds[0];
  assert.equal(c.pitch, 1.5);
});

test('jump is coerced with !!', () => {
  const j = (v) => parseClientMessage(input([goodCmd({ jump: v })])).msg.cmds[0].jump;
  assert.equal(j(true), true);
  assert.equal(j(1), true);
  assert.equal(j('yes'), true);
  assert.equal(j(0), false);
  assert.equal(j(false), false);
  assert.equal(j(null), false);
  assert.equal(j(''), false);
});

test('missing jump is coerced to false, not rejected', () => {
  const c = goodCmd();
  delete c.jump;
  const r = parseClientMessage(input([c]));
  assert.equal(r.ok, true);
  assert.strictEqual(r.msg.cmds[0].jump, false);
});

test('command extra fields are dropped and __proto__ inside a command has no effect', () => {
  const raw = '{"t":"input","cmds":[{"seq":1,"fwd":0,"right":0,"yaw":0,"pitch":0,"isAdmin":true,"hp":500,"__proto__":{"jump":true}}]}';
  const r = parseClientMessage(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg.cmds[0], { seq: 1, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, yaw: 0, pitch: 0 });
  assert.equal(r.msg.isAdmin, undefined);
});

test('input message extra top-level fields are dropped', () => {
  const r = parseClientMessage(`{"t":"input","admin":true,"cmds":[${JSON.stringify(goodCmd())}]}`);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.msg).sort(), ['cmds', 't']);
});

test('the returned msg is a fresh object: mutating it does not affect a later parse', () => {
  const raw = '{"t":"join","name":"Bob"}';
  const a = parseClientMessage(raw);
  a.msg.name = 'HACKED';
  assert.equal(parseClientMessage(raw).msg.name, 'Bob');
});

// ---------- never throws ----------
test('never throws for non-string non-Buffer inputs; always ok:false', () => {
  for (const raw of [undefined, null, 0, 1, NaN, true, {}, [], () => 1, Symbol('s'), 10n, new Uint8Array(0)]) {
    const r = parseClientMessage(raw);
    assert.equal(r.ok, false, `raw=${typeof raw}`);
  }
});

test('deeply nested JSON under the size limit does not throw', () => {
  const r = parseClientMessage('['.repeat(2000) + ']'.repeat(2000));
  assert.equal(r.ok, false);
});

test('huge unclosed nesting does not throw', () => {
  const r = parseClientMessage('{"a":'.repeat(700));
  assert.equal(r.ok, false);
});

test('property: parseClientMessage never throws for random junk strings and Buffers, and reasons are from the documented set', () => {
  const rnd = mulberry32(90210);
  for (let i = 0; i < 1500; i++) {
    const len = Math.floor(rnd() * (i % 50 === 0 ? 6000 : 200));
    const bytes = Buffer.alloc(len);
    for (let j = 0; j < len; j++) bytes[j] = Math.floor(rnd() * 256);
    for (const raw of [bytes, bytes.toString('latin1'), bytes.toString('utf8')]) {
      const r = parseClientMessage(raw);
      assert.equal(typeof r.ok, 'boolean');
      if (!r.ok) assert.ok(REASONS.has(r.reason), `reason ${r.reason}`);
      else assert.ok(['join', 'shoot', 'input'].includes(r.msg.t));
    }
  }
});

test('property: any accepted input message satisfies the clamping invariants', () => {
  const rnd = mulberry32(555);
  const wild = () => [0, 1, -1, 0.5, 1e6, -1e6, 1e-9, 3.3, -3.3, 1.5533, 1.5534, -1.5534][Math.floor(rnd() * 12)];
  for (let i = 0; i < 500; i++) {
    const n = 1 + Math.floor(rnd() * 8);
    const cmds = Array.from({ length: n }, (_, k) => goodCmd({ seq: k, fwd: wild(), right: wild(), yaw: wild(), pitch: wild(), jump: rnd() < 0.5 }));
    const r = parseClientMessage(input(cmds));
    assert.equal(r.ok, true);
    for (const c of r.msg.cmds) {
      assert.ok(c.fwd >= -1 && c.fwd <= 1);
      assert.ok(c.right >= -1 && c.right <= 1);
      assert.ok(c.pitch >= -1.5533 && c.pitch <= 1.5533);
      assert.ok(Number.isFinite(c.yaw));
      assert.equal(typeof c.jump, 'boolean');
      assert.ok(Number.isSafeInteger(c.seq) && c.seq >= 0);
    }
  }
});

// ---------- throw (SPEC §15.4, D-012/D-015) ----------
test('throw is accepted and yields exactly { t: "throw" }', () => {
  assert.deepEqual(parseClientMessage('{"t":"throw"}'), { ok: true, msg: { t: 'throw' } });
});

test('throw drops every smuggled field (position, velocity, fuse, damage, owner)', () => {
  const raw = JSON.stringify({ t: 'throw', x: 0, y: 99, z: 0, vx: 1e9, fuseMs: 0, damage: 1e6, owner: 1, id: 7, __proto__: { isAdmin: true } });
  const r = parseClientMessage(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.msg), ['t']);
  assert.equal(Object.getPrototypeOf(r.msg), Object.prototype);
});

test('a JSON "__proto__" key on throw does not pollute the result', () => {
  const r = parseClientMessage('{"t":"throw","__proto__":{"polluted":1}}');
  assert.deepEqual(r.msg, { t: 'throw' });
  assert.equal(({}).polluted, undefined);
});

for (const raw of ['{"t":"THROW"}', '{"t":"throw "}', '{"t":["throw"]}', '[{"t":"throw"}]', '{"t":"grenade"}', '{"t":"boom"}', '{"t":"verdict"}']) {
  test(`throw look-alike ${raw} is bad_shape`, () => {
    assert.deepEqual(parseClientMessage(raw), { ok: false, reason: 'bad_shape' });
  });
}

test('an oversized throw is too_large', () => {
  const raw = '{"t":"throw","pad":"' + 'x'.repeat(4096) + '"}';
  assert.deepEqual(parseClientMessage(raw), { ok: false, reason: 'too_large' });
});

// SPEC 18.1: optional client clock stamp on input messages
test('input ts: a finite non-negative number is kept, anything else is dropped without failing the message', () => {
  const cmds = [{ seq: 1, fwd: 0, right: 0, jump: false, yaw: 0, pitch: 0 }];
  const ok = validateClientMessage({ t: 'input', cmds, ts: 1_791_051_197_625 });
  assert.equal(ok.ok, true);
  assert.equal(ok.msg.ts, 1_791_051_197_625);
  for (const bad of [undefined, -1, 'now', NaN, Infinity, null, {}]) {
    const r = validateClientMessage({ t: 'input', cmds, ts: bad });
    assert.equal(r.ok, true, `ts=${String(bad)}`);
    assert.equal('ts' in r.msg, false, `ts=${String(bad)}`);
  }
});

// ---------- ping (SPEC 18.2) ----------

test('ping: id and ts are whitelisted, everything else dropped', () => {
  const r = validateClientMessage({ t: 'ping', id: 3, ts: 1_700_000_000_000, isAdmin: true });
  assert.deepEqual(r, { ok: true, msg: { t: 'ping', id: 3, ts: 1_700_000_000_000 } });
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'ping', id: 0, ts: 0 })).msg, { t: 'ping', id: 0, ts: 0 });
});

test('ping: a bad id or ts is bad_ping', () => {
  for (const bad of [
    { t: 'ping' },
    { t: 'ping', id: -1, ts: 1 },
    { t: 'ping', id: 1.5, ts: 1 },
    { t: 'ping', id: '1', ts: 1 },
    { t: 'ping', id: 1 },
    { t: 'ping', id: 1, ts: -1 },
    { t: 'ping', id: 1, ts: Infinity },
    { t: 'ping', id: 1, ts: 'now' },
  ]) {
    assert.deepEqual(validateClientMessage(bad), { ok: false, reason: 'bad_ping' }, JSON.stringify(bad));
  }
});

// SPEC 20.3: weapon intents
test('reload and switch intents are whitelisted; switch needs a known slot', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'reload', hp: 999 })), { ok: true, msg: { t: 'reload' } });
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'switch', slot: 'sidearm' })), { ok: true, msg: { t: 'switch', slot: 'sidearm' } });
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'switch', slot: 'primary', mag: 99 })), { ok: true, msg: { t: 'switch', slot: 'primary' } });
  for (const slot of ['knife', '', 0, null, undefined, {}, '__proto__']) {
    assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'switch', slot })), { ok: false, reason: 'bad_switch' }, String(slot));
  }
});

// SPEC 34: ceremony protocol messages
test('vote: mapId string <= 32 chars is whitelisted', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'vote', mapId: 'foundry', extra: 'drop' })), { ok: true, msg: { t: 'vote', mapId: 'foundry' } });
  for (const badMap of ['', 123, null, 'a'.repeat(33), {}, []]) {
    assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'vote', mapId: badMap })), { ok: false, reason: 'bad_vote' }, String(badMap));
  }
});
