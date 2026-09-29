// SPEC sections 6 and 12: Origin checking on the WebSocket upgrade (cross-site WebSocket hijacking defence).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, waitFor, connectEventually } from '../helpers/harness.js';

describe('same-origin mode (allowedOrigins = [])', () => {
  const ctx = useServer({});

  const rejected = [
    ['missing Origin header', () => false],
    ['empty Origin header', () => ''],
    ['Origin: null', () => 'null'],
    ['Origin: NULL (case)', () => 'NULL'],
    ['foreign origin', () => 'http://evil.example'],
    ['foreign origin https', () => 'https://evil.example'],
    ['right port, foreign host', (p) => `http://evil.example:${p}`],
    ['right host, missing port', () => 'http://127.0.0.1'],
    ['right host, wrong port', (p) => `http://127.0.0.1:${(p % 60000) + 1}`],
    ['host suffix trick (x127.0.0.1)', (p) => `http://x127.0.0.1:${p}`],
    ['host prefix trick (127.0.0.1.evil)', (p) => `http://127.0.0.1.evil.example:${p}`],
    ['port suffix trick (port digits appended)', (p) => `http://127.0.0.1:${p}0`],
    ['port followed by domain', (p) => `http://127.0.0.1:${p}.evil.example`],
    ['user@evil: userinfo looks like the host', (p) => `http://127.0.0.1:${p}@evil.example`],
    ['different host name for the same machine (localhost)', (p) => `http://localhost:${p}`],
    ['garbage that is not a URL', () => 'not a url'],
    ['scheme-only', () => 'http://'],
    ['javascript: scheme', () => 'javascript:alert(1)'],
    ['file: scheme', () => 'file://'],
  ];
  for (const [name, make] of rejected) {
    it(`rejects with HTTP 403 and no WebSocket: ${name}`, async () => {
      const r = await ctx.tryOpen({ origin: make(ctx.port) });
      assert.equal(r.ok, false, 'must not upgrade');
      assert.equal(r.status, 403, `expected 403, got ${JSON.stringify({ status: r.status, err: r.error && r.error.message })}`);
      assert.equal(ctx.room.playerCount, 0);
    });
  }

  it('accepts the same-origin Origin (host and port equal the Host header)', async () => {
    const r = await ctx.tryOpen({ origin: `http://127.0.0.1:${ctx.port}` });
    assert.equal(r.ok, true);
  });

  it('same-origin mode does not compare the scheme', async () => {
    const r = await ctx.tryOpen({ origin: `https://127.0.0.1:${ctx.port}` });
    assert.equal(r.ok, true);
  });

  it('the comparison against the Host header is case-insensitive', async () => {
    const r = await ctx.tryOpen({ origin: `HTTP://127.0.0.1:${ctx.port}`, headers: { Host: `127.0.0.1:${ctx.port}` } });
    assert.equal(r.ok, true);
  });

  it('a rejected upgrade does not stop later legitimate clients from connecting', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await ctx.tryOpen({ origin: 'http://evil.example' })).status, 403);
    const good = await ctx.open();
    await good.join('Fine');
    assert.equal(ctx.room.playerCount, 1);
  });

  it('rejected upgrades (bad origin / bad path) do not leak per-IP slots: 8 legitimate sockets still fit afterwards', async () => {
    for (let i = 0; i < 12; i++) {
      assert.equal((await ctx.tryOpen({ origin: 'http://evil.example' })).status, 403);
      const wrongPath = await ctx.tryOpen({ path: '/not-ws' });
      assert.equal(wrongPath.ok, false);
    }
    for (let i = 0; i < 8; i++) {
      const r = await ctx.tryOpen({ retry429: true });
      assert.equal(r.ok, true, `legit socket #${i + 1} must be accepted, got ${JSON.stringify({ status: r.status })}`);
    }
  });
});

describe('allowlist mode', () => {
  const ctx = useServer({ allowedOrigins: ['http://app.example.com', 'https://other.example.com:8443'] });

  it('accepts exactly the listed origins', async () => {
    assert.equal((await ctx.tryOpen({ origin: 'http://app.example.com' })).ok, true);
    assert.equal((await ctx.tryOpen({ origin: 'https://other.example.com:8443' })).ok, true);
  });

  it('compares the lowercased Origin to the entries', async () => {
    assert.equal((await ctx.tryOpen({ origin: 'HTTP://APP.EXAMPLE.COM' })).ok, true);
  });

  it('once an allowlist is set, the same-origin shortcut no longer applies', async () => {
    const r = await ctx.tryOpen({ origin: `http://127.0.0.1:${ctx.port}` });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  const rejected = [
    ['missing header', false],
    ['null', 'null'],
    ['empty', ''],
    ['trailing slash', 'http://app.example.com/'],
    ['different scheme', 'https://app.example.com'],
    ['extra port', 'http://app.example.com:80'],
    ['listed origin as prefix of a longer host', 'http://app.example.com.evil.example'],
    ['listed origin as suffix of a longer host', 'http://evilapp.example.com'],
    ['subdomain', 'http://sub.app.example.com'],
    ['userinfo trick', 'http://app.example.com@evil.example'],
    ['userinfo trick reversed', 'http://evil.example@app.example.com'],
    ['unlisted port', 'https://other.example.com:9443'],
    ['listed host without its port', 'https://other.example.com'],
  ];
  for (const [name, origin] of rejected) {
    it(`rejects with 403: ${name}`, async () => {
      const r = await ctx.tryOpen({ origin });
      assert.equal(r.ok, false);
      assert.equal(r.status, 403, `got ${JSON.stringify({ status: r.status, err: r.error && r.error.message })}`);
    });
  }
});

describe('rejection logging', () => {
  const ctx = useServer({ logLevel: 'warn' });

  function parsedLogs() {
    return ctx.logs.map((line) => {
      assert.equal(typeof line, 'string');
      assert.ok(!/[\r\n]/.test(line), `log line must be a single line: ${JSON.stringify(line)}`);
      return JSON.parse(line);
    });
  }
  const rejectionLines = () => parsedLogs().filter((o) => o.msg === 'websocket rejected: origin');

  it('logs a rejected origin at warn as valid single-line JSON', async () => {
    const r = await ctx.tryOpen({ origin: 'http://evil.example' });
    assert.equal(r.status, 403);
    await waitFor(() => rejectionLines().length >= 1, { what: 'rejection log line' });
    const line = rejectionLines()[0];
    assert.equal(line.level, 'warn');
    assert.equal(typeof line.ts, 'string');
    assert.ok(!Number.isNaN(Date.parse(line.ts)), 'ts is an ISO date');
    assert.equal(typeof line.logger, 'string');
    assert.ok(Object.values(line).some((v) => typeof v === 'string' && v.includes('evil.example')), 'the offending origin is logged');
  });

  it('cuts a very long origin to at most 100 characters in every logged field', async () => {
    const huge = `http://${'a'.repeat(400)}.example`;
    const r = await ctx.tryOpen({ origin: huge });
    assert.equal(r.status, 403);
    await waitFor(() => rejectionLines().length >= 1, { what: 'rejection log line' });
    const line = rejectionLines()[0];
    const reserved = new Set(['ts', 'level', 'logger', 'msg']);
    const carrying = Object.entries(line).filter(([k, v]) => !reserved.has(k) && typeof v === 'string' && v.includes('aaaa'));
    assert.ok(carrying.length >= 1, 'a field carries the (truncated) origin');
    for (const [k, v] of carrying) assert.ok([...v].length <= 100, `field ${k} has ${[...v].length} chars`);
    for (const l of ctx.logs) assert.ok(!l.includes('a'.repeat(101)), 'no log line contains the untruncated origin');
  });

  it('hostile characters in the origin (quotes, backslash, tab, latin-1) cannot break the log format', async () => {
    const r = await ctx.tryOpen({ origin: 'http://ev"il\\.example\t"},{"msg":"forged","level":"error' });
    assert.equal(r.status, 403);
    await waitFor(() => rejectionLines().length >= 1, { what: 'rejection log line' });
    const all = parsedLogs();
    assert.ok(all.every((o) => o.msg !== 'forged'), 'no forged log record');
    assert.equal(all.filter((o) => o.msg === 'websocket rejected: origin').length, 1);
  });

  it('accepted connections are not logged as rejections', async () => {
    const c = await ctx.open();
    await c.join('Quiet');
    await c.nextSnaps(2);
    assert.equal(rejectionLines().length, 0);
  });
});

describe('rejection logging is filtered by logLevel', () => {
  const ctx = useServer({ logLevel: 'error' });

  it('logLevel error suppresses the warn-level rejection line', async () => {
    const r = await ctx.tryOpen({ origin: 'http://evil.example' });
    assert.equal(r.status, 403);
    // Round trip through a legitimate connection so the server has certainly finished handling the rejection.
    const ok = await connectEventually(ctx.port, {});
    assert.equal(ok.ok, true);
    ctx.clients.push(ok.client);
    assert.deepEqual(ctx.logs.filter((l) => l.includes('websocket rejected')), []);
  });
});
