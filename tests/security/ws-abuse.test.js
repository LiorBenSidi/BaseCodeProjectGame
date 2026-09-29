// SPEC section 12: protocol abuse handling on /ws (paths, frame types, sizes, strikes, flood, per-IP cap).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, waitFor, delay, cmd, tryConnect, connectEventually } from '../helpers/harness.js';

const BAD_JSON = 'this is { not json';
const UNKNOWN_TYPE = JSON.stringify({ t: 'teleport', x: 1 });
const EMPTY_CMDS = JSON.stringify({ t: 'input', cmds: [] });
const NEGATIVE_SEQ = JSON.stringify({ t: 'input', cmds: [cmd(-1)] });
const STRING_FWD = JSON.stringify({ t: 'input', cmds: [{ ...cmd(1), fwd: '1' }] });
const INFINITE_FWD = '{"t":"input","cmds":[{"seq":1,"fwd":1e999,"right":0,"jump":false,"yaw":0,"pitch":0}]}';
const UNSAFE_SEQ = '{"t":"input","cmds":[{"seq":9007199254740993,"fwd":0,"right":0,"jump":false,"yaw":0,"pitch":0}]}';
const FRACTIONAL_SEQ = JSON.stringify({ t: 'input', cmds: [cmd(1.5)] });
const TOO_MANY_CMDS = JSON.stringify({ t: 'input', cmds: Array.from({ length: 9 }, (_, i) => cmd(i + 1)) });
const CMDS_NOT_ARRAY = JSON.stringify({ t: 'input', cmds: { seq: 1 } });
const MISSING_TYPE = JSON.stringify({ hello: 'world' });

describe('upgrade path and frame type', () => {
  const ctx = useServer({});

  it('upgrades on any path other than /ws are destroyed without an HTTP response', async () => {
    for (const path of ['/', '/nope', '/ws2', '/wss', '/ws/x', '/socket']) {
      const r = await ctx.tryOpen({ path });
      assert.equal(r.ok, false, `${path} must not upgrade`);
      assert.equal(r.status, undefined, `${path}: connection is destroyed, no HTTP status (got ${r.status})`);
      assert.ok(r.error, `${path}: client sees a connection error`);
    }
    assert.equal(ctx.room.playerCount, 0);
  });

  it('a binary frame closes the socket with 1003', async () => {
    const c = await ctx.open();
    c.sendRaw(Buffer.from([1, 2, 3]), { binary: true });
    assert.equal(await c.waitClosed(), 1003);
  });

  it('a binary frame that contains valid JSON is still refused with 1003 and creates no player', async () => {
    const c = await ctx.open();
    c.sendRaw(Buffer.from(JSON.stringify({ t: 'join', name: 'Bin' })), { binary: true });
    assert.equal(await c.waitClosed(), 1003);
    assert.equal(ctx.room.playerCount, 0);
  });

  it('a binary frame from a joined player closes it with 1003 and frees the player', async () => {
    const c = await ctx.open();
    await c.join('Bin');
    c.sendRaw(Buffer.from([0xff, 0x00]), { binary: true });
    assert.equal(await c.waitClosed(), 1003);
    await waitFor(() => ctx.room.playerCount === 0, { what: 'player removed after 1003' });
  });
});

describe('frame size limit (4096 bytes)', () => {
  const ctx = useServer({});

  function joinOfSize(bytes) {
    const base = JSON.stringify({ t: 'join', name: 'Big', pad: '' });
    const raw = JSON.stringify({ t: 'join', name: 'Big', pad: 'x'.repeat(bytes - Buffer.byteLength(base)) });
    assert.equal(Buffer.byteLength(raw), bytes);
    return raw;
  }

  it('an oversized frame closes the socket with 1009', async () => {
    const c = await ctx.open();
    c.sendRaw('x'.repeat(5000));
    assert.equal(await c.waitClosed(), 1009);
  });

  it('a huge frame closes the socket and creates no player', async () => {
    const c = await ctx.open();
    c.sendRaw(JSON.stringify({ t: 'join', name: 'A'.repeat(200000) }));
    await c.waitClosed();
    assert.equal(c.closeCode, 1009);
    assert.equal(ctx.room.playerCount, 0);
  });

  it('a frame of exactly 4097 bytes is refused', async () => {
    const c = await ctx.open();
    c.sendRaw(joinOfSize(4097));
    assert.equal(await c.waitClosed(), 1009);
    assert.equal(ctx.room.playerCount, 0);
  });

  it('a frame of exactly 4096 bytes is still accepted', async () => {
    const c = await ctx.open();
    c.sendRaw(joinOfSize(4096));
    const welcome = await waitFor(() => c.ofType('welcome')[0], { what: 'welcome for a 4096-byte join' });
    assert.equal(welcome.t, 'welcome');
    assert.equal(c.isOpen, true);
  });
});

describe('protocol strikes', () => {
  const ctx = useServer({});

  it('the 5th invalid message closes the socket with 1008', async () => {
    const c = await ctx.open();
    for (let i = 0; i < 5; i++) c.sendRaw(BAD_JSON);
    assert.equal(await c.waitClosed(), 1008);
  });

  it('4 invalid messages leave the connection open and usable', async () => {
    const c = await ctx.open();
    for (const m of [BAD_JSON, UNKNOWN_TYPE, EMPTY_CMDS, MISSING_TYPE]) c.sendRaw(m);
    await c.join('Survivor');
    assert.equal(c.isOpen, true);
    assert.equal(c.closed, false);
    assert.equal(ctx.room.playerCount, 1);
  });

  it('valid messages between strikes do not reset the count (4 bad + valid + 1 bad = closed)', async () => {
    const c = await ctx.open();
    c.sendRaw(BAD_JSON);
    c.sendRaw(UNKNOWN_TYPE);
    await c.join('Counter');
    c.send({ t: 'input', cmds: [cmd(1)] });
    c.sendRaw(EMPTY_CMDS);
    c.sendRaw(BAD_JSON);
    await waitFor(() => c.lastSnap && c.lastSnap.ack >= 1, { what: 'valid input still processed after 4 strikes' });
    assert.equal(c.closed, false, 'still open after 4 strikes');
    c.send({ t: 'shoot' });
    c.sendRaw(UNKNOWN_TYPE);
    assert.equal(await c.waitClosed(), 1008);
  });

  const variants = {
    'bad JSON': BAD_JSON,
    'unknown message type': UNKNOWN_TYPE,
    'missing type': MISSING_TYPE,
    'empty cmds': EMPTY_CMDS,
    'negative seq': NEGATIVE_SEQ,
    'fractional seq': FRACTIONAL_SEQ,
    'unsafe-integer seq': UNSAFE_SEQ,
    'string fwd': STRING_FWD,
    'infinite fwd (1e999)': INFINITE_FWD,
    'more than 8 commands': TOO_MANY_CMDS,
    'cmds is not an array': CMDS_NOT_ARRAY,
    'JSON array instead of object': '[1,2,3]',
    'JSON null': 'null',
    'JSON scalar': '42',
  };
  for (const [name, raw] of Object.entries(variants)) {
    it(`each ${name} counts as a strike (5 of them close with 1008)`, async () => {
      const c = await ctx.open({ retry429: true });
      for (let i = 0; i < 5; i++) c.sendRaw(raw);
      assert.equal(await c.waitClosed(), 1008);
    });
  }

  it('finite but out-of-range values are clamped, not treated as strikes', async () => {
    const c = await ctx.open();
    await c.join('Clamp');
    for (let i = 1; i <= 8; i++) c.send({ t: 'input', cmds: [cmd(i, { fwd: 100, right: -100, pitch: 9, yaw: 1000 })] });
    await waitFor(() => c.lastSnap.ack >= 8, { what: 'ack 8 for out-of-range but finite commands' });
    assert.equal(c.closed, false);
  });

  it('a strike does not prevent later valid input from being processed', async () => {
    const c = await ctx.open();
    await c.join('Recover');
    c.sendRaw(BAD_JSON);
    c.send({ t: 'input', cmds: [cmd(3)] });
    await waitFor(() => c.lastSnap.ack === 3);
  });
});

describe('rate limiting', () => {
  const ctx = useServer({});

  it('a burst of 400 tiny valid messages closes the socket with 1008', async () => {
    const c = await ctx.open();
    await c.join('Flooder');
    for (let i = 0; i < 400; i++) c.sendRaw('{"t":"shoot"}');
    assert.equal(await c.waitClosed(5000), 1008);
    await waitFor(() => ctx.room.playerCount === 0, { what: 'flooder removed' });
  });

  it('a burst of 400 valid input messages from an unjoined socket also ends in 1008', async () => {
    const c = await ctx.open();
    const raw = JSON.stringify({ t: 'input', cmds: [cmd(1)] });
    for (let i = 0; i < 400; i++) c.sendRaw(raw);
    assert.equal(await c.waitClosed(5000), 1008);
  });

  it('a well-behaved 60 Hz sender is never closed and all its commands are acked', async () => {
    const c = await ctx.open();
    await c.join('Steady');
    const t0 = performance.now();
    const total = 120; // 2 seconds at 60 Hz
    for (let i = 0; i < total; i++) {
      const wait = t0 + i * (1000 / 60) - performance.now();
      if (wait > 0) await delay(wait);
      c.send({ t: 'input', cmds: [cmd(i + 1)] });
    }
    await waitFor(() => c.lastSnap.ack >= total, { timeoutMs: 4000, what: `ack ${total}` });
    assert.equal(c.closed, false);
    assert.equal(c.isOpen, true);
  });

  it('flooding one socket does not disturb another connection', async () => {
    const victim = await ctx.open();
    await victim.join('Bystander');
    const flooder = await ctx.open();
    await flooder.join('Noisy');
    for (let i = 0; i < 400; i++) flooder.sendRaw('{"t":"shoot"}');
    await flooder.waitClosed(5000);
    await victim.nextSnaps(5);
    assert.equal(victim.closed, false);
    assert.equal(ctx.room.playerCount, 1);
  });
});

describe('per-IP connection cap (8)', () => {
  const ctx = useServer({});

  it('the 9th concurrent upgrade gets HTTP 429 and is accepted once one socket closes', async () => {
    const held = [];
    for (let i = 0; i < 8; i++) held.push(await ctx.open());
    const ninth = await ctx.tryOpen();
    assert.equal(ninth.ok, false);
    assert.equal(ninth.status, 429);
    assert.ok(held.every((c) => c.isOpen), 'the rejected attempt does not disturb the 8 established sockets');
    await held[0].close();
    const again = await ctx.tryOpen({ retry429: true });
    assert.equal(again.ok, true, `expected acceptance after a slot freed, got ${JSON.stringify({ status: again.status })}`);
  });

  it('the cap counts sockets that never joined', async () => {
    for (let i = 0; i < 8; i++) await ctx.open();
    assert.equal(ctx.room.playerCount, 0);
    assert.equal((await ctx.tryOpen()).status, 429);
  });

  it('repeated 429 rejections do not consume or leak slots', async () => {
    const held = [];
    for (let i = 0; i < 8; i++) held.push(await ctx.open());
    for (let i = 0; i < 10; i++) assert.equal((await ctx.tryOpen()).status, 429);
    for (const c of held) await c.close();
    for (let i = 0; i < 8; i++) {
      const r = await ctx.tryOpen({ retry429: true });
      assert.equal(r.ok, true, `slot #${i + 1} must be available again`);
    }
  });

  it('sockets terminated abruptly release their slots', async () => {
    const first = [];
    for (let i = 0; i < 8; i++) first.push(await ctx.open());
    for (const c of first) c.dispose();
    for (let i = 0; i < 8; i++) {
      const r = await ctx.tryOpen({ retry429: true });
      assert.equal(r.ok, true, `slot #${i + 1} available after abrupt closes`);
    }
  });

  it('sockets closed by the server (1003 / 1008 / 1009) release their slots', async () => {
    for (let round = 0; round < 3; round++) {
      const kicked = [];
      for (let i = 0; i < 8; i++) {
        const c = await ctx.open({ retry429: true });
        kicked.push(c);
        if (i % 3 === 0) c.sendRaw(Buffer.from([1]), { binary: true });
        else if (i % 3 === 1) c.sendRaw('y'.repeat(5000));
        else for (let k = 0; k < 5; k++) c.sendRaw(BAD_JSON);
      }
      for (const c of kicked) await c.waitClosed();
    }
    for (let i = 0; i < 8; i++) {
      const r = await ctx.tryOpen({ retry429: true });
      assert.equal(r.ok, true, `slot #${i + 1} available after server-side kicks`);
    }
  });
});

describe('input and shoot before join', () => {
  const ctx = useServer({});

  it('are ignored: no player is created and the socket stays open', async () => {
    const early = await ctx.open();
    early.send({ t: 'input', cmds: [cmd(1, { fwd: 1 })] });
    early.send({ t: 'shoot' });
    early.send({ t: 'input', cmds: [cmd(2)] });
    const probe = await ctx.open();
    await probe.join('Probe');
    await probe.nextSnaps(4);
    assert.equal(ctx.room.playerCount, 1, 'only the probe exists');
    assert.equal(probe.lastSnap.players.length, 1);
    assert.equal(early.isOpen, true);
    assert.equal(early.messages.length, 0, 'the early socket receives nothing');
    assert.equal(probe.ofType('shot').length, 0);
  });

  it('do not poison a later join on the same socket', async () => {
    const c = await ctx.open();
    c.send({ t: 'input', cmds: [cmd(50)] });
    c.send({ t: 'shoot' });
    await c.join('Late');
    await c.nextSnaps(3);
    assert.equal(c.lastSnap.ack, -1, 'pre-join input must not leak into the new player (ack stays -1)');
    assert.equal(c.ofType('shot').length, 0, 'pre-join shoot must not fire after joining');
  });

  it('many pre-join messages within the rate limit never close the socket', async () => {
    const c = await ctx.open();
    for (let i = 0; i < 60; i++) c.send({ t: 'shoot' });
    await c.join('StillHere');
    assert.equal(c.closed, false);
  });
});

describe('connection races', () => {
  const ctx = useServer({});

  it('a client that connects and vanishes without sending anything leaves no state behind', async () => {
    const r = await tryConnect(ctx.port);
    r.client.dispose();
    await waitFor(async () => (await ctx.readyz()).players === 0);
    const ok = await connectEventually(ctx.port);
    assert.equal(ok.ok, true);
    ctx.clients.push(ok.client);
  });

  it('join immediately followed by close never leaves a ghost player', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await ctx.open({ retry429: true });
      c.send({ t: 'join', name: `Ghost${i}` });
      c.dispose();
    }
    await waitFor(() => ctx.room.playerCount === 0, { what: 'no ghost players' });
  });
});
