// SPEC section 12 in production-like mode: real vite build, client:'static', isProd:true.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, httpRequest, tryConnect, waitFor, cmd } from '../helpers/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
const PROD_CSP_PARTS = ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"];

function viteBin() {
  const entry = fileURLToPath(import.meta.resolve('vite'));
  const marker = `${path.sep}node_modules${path.sep}vite${path.sep}`;
  const i = entry.lastIndexOf(marker);
  assert.ok(i >= 0, `cannot locate the vite package from ${entry}`);
  return path.join(entry.slice(0, i + marker.length), 'bin', 'vite.js');
}

function assertProdHeaders(res, label) {
  const h = res.headers;
  assert.equal(h['x-content-type-options'], 'nosniff', `${label}: nosniff`);
  assert.equal(h['referrer-policy'], 'no-referrer', `${label}: referrer-policy`);
  assert.equal(h['cross-origin-opener-policy'], 'same-origin', `${label}: COOP`);
  assert.equal(h['x-frame-options'], 'DENY', `${label}: XFO`);
  const csp = h['content-security-policy'];
  assert.ok(csp, `${label}: CSP`);
  for (const part of PROD_CSP_PARTS) assert.ok(csp.includes(part), `${label}: CSP has ${part}`);
}

describe('production build served statically', () => {
  let t;

  before(
    async () => {
      const bin = viteBin();
      assert.ok(existsSync(bin), `vite CLI not found at ${bin}`);
      try {
        execFileSync(process.execPath, [bin, 'build'], { cwd: ROOT, stdio: 'pipe', timeout: 240000, encoding: 'utf8' });
      } catch (err) {
        throw new Error(`vite build failed: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}`);
      }
      assert.ok(existsSync(path.join(DIST, 'index.html')), 'vite build must produce dist/index.html');
      t = await startTestServer({ client: 'static', isProd: true });
    },
    { timeout: 300000 },
  );

  after(async () => {
    if (t) await t.close();
  });

  it('GET / serves the HTML shell with no-cache and the production security headers', async () => {
    const res = await httpRequest(t.port, { path: '/' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.ok(res.text.includes('Base Code Arena'), 'page contains the game title');
    assert.ok(res.headers['cache-control'].includes('no-cache'), `cache-control: ${res.headers['cache-control']}`);
    assertProdHeaders(res, 'GET /');
  });

  it('GET / with a query string or fragment-like suffix still serves the shell', async () => {
    const res = await httpRequest(t.port, { path: '/?room=1' });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Base Code Arena'));
  });

  it('HEAD / answers 200 with no body and the same headers', async () => {
    const res = await httpRequest(t.port, { method: 'HEAD', path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 0);
    assert.match(res.headers['content-type'], /^text\/html/);
    assertProdHeaders(res, 'HEAD /');
  });

  it('built assets are served byte-for-byte with the right type and immutable caching', async () => {
    const dir = path.join(DIST, 'assets');
    assert.ok(existsSync(dir), 'dist/assets exists');
    const files = readdirSync(dir).filter((f) => /\.(js|css)$/.test(f));
    assert.ok(files.some((f) => f.endsWith('.js')), 'the build produced at least one .js asset');
    for (const f of files) {
      const res = await httpRequest(t.port, { path: `/assets/${f}` });
      assert.equal(res.status, 200, f);
      const expectedType = f.endsWith('.js') ? /^text\/javascript/ : /^text\/css/;
      assert.match(res.headers['content-type'], expectedType, `${f}: content-type ${res.headers['content-type']}`);
      assert.ok(res.headers['cache-control'].includes('immutable'), `${f}: cache-control ${res.headers['cache-control']}`);
      assert.ok(res.body.equals(readFileSync(path.join(dir, f))), `${f}: body matches dist file`);
      assertProdHeaders(res, f);
      const head = await httpRequest(t.port, { method: 'HEAD', path: `/assets/${f}` });
      assert.equal(head.status, 200);
      assert.equal(head.body.length, 0);
    }
  });

  it('the asset URLs referenced by index.html all resolve', async () => {
    const html = (await httpRequest(t.port, { path: '/' })).text;
    const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 1, 'index.html references at least one built asset');
    for (const ref of refs) assert.equal((await httpRequest(t.port, { path: ref })).status, 200, ref);
  });

  const notFound = [
    '/assets/does-not-exist.js',
    '/assets/',
    '/.env',
    '/.git/config',
    '/.git/HEAD',
    '/assets/.hidden',
    '/%2e%2e/package.json',
    '/%2E%2E/package.json',
    '/../package.json',
    '/../../package.json',
    '/assets/../../package.json',
    '/..%2fpackage.json',
    '/%2e%2e%2fpackage.json',
    '/..%5cpackage.json',
    '/assets/..%5c..%5cpackage.json',
    '/%252e%252e/package.json',
    '/index.html%00.png',
    '/%00',
    '/node_modules/ws/package.json',
    '/src/server/server.js',
    '/package.json',
    '/docs/SPEC.md',
  ];
  for (const p of notFound) {
    it(`refuses ${p} with 404 and leaks nothing`, async () => {
      const res = await httpRequest(t.port, { path: p });
      assert.equal(res.status, 404, `GET ${p}`);
      assert.ok(!res.text.includes('base-code-project-game'), 'no repo package.json content');
      assert.ok(!res.text.includes('[core]'), 'no .git/config content');
      assert.ok(!res.text.includes('Behavior Specification'), 'no repo docs content');
      assertProdHeaders(res, `404 for ${p}`);
    });
  }

  it('non-GET/HEAD methods are 405 with Allow, also on static paths', async () => {
    for (const path of ['/', '/assets/x.js', '/healthz']) {
      const res = await httpRequest(t.port, { method: 'POST', path });
      assert.equal(res.status, 405, path);
      assert.equal(res.headers['allow'], 'GET, HEAD');
      assertProdHeaders(res, `POST ${path}`);
    }
  });

  it('/healthz and /readyz still work in static mode (and take precedence over static files)', async () => {
    const h = await httpRequest(t.port, { path: '/healthz' });
    assert.equal(h.status, 200);
    assert.deepEqual(JSON.parse(h.text), { status: 'ok' });
    assertProdHeaders(h, '/healthz');
    const r = await httpRequest(t.port, { path: '/readyz' });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.text).status, 'ready');
  });

  it('a complete player session over WebSocket works against the production server', async () => {
    const r = await tryConnect(t.port);
    assert.equal(r.ok, true, `upgrade failed: ${JSON.stringify({ status: r.status })}`);
    const c = r.client;
    try {
      const id = await c.join('Prod Player');
      assert.equal(c.ofType('welcome')[0].tickRate, 30);
      assert.equal(c.me().name, 'Prod Player');
      assert.equal(c.me().hp, 100);
      assert.deepEqual(JSON.parse((await httpRequest(t.port, { path: '/readyz' })).text), { status: 'ready', players: 1 });

      c.send({ t: 'input', cmds: [1, 2, 3].map((s) => cmd(s, { fwd: 1, yaw: 0.5, pitch: 0.1 })) });
      await waitFor(() => c.lastSnap.ack >= 3, { what: 'ack 3' });
      assert.ok(Math.abs(c.me().yaw - 0.5) < 0.002);

      c.send({ t: 'shoot' });
      const shot = await waitFor(() => c.ofType('shot')[0], { what: 'own shot event' });
      assert.equal(shot.id, id);

      await c.close();
      assert.equal(c.closeCode, 1000);
      await waitFor(async () => JSON.parse((await httpRequest(t.port, { path: '/readyz' })).text).players === 0, { what: 'readyz players 0' });
    } finally {
      c.dispose();
    }
  });

  it('the production server still enforces the Origin check', async () => {
    const foreign = await tryConnect(t.port, { origin: 'http://evil.example' });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.status, 403);
    const missing = await tryConnect(t.port, { origin: false });
    assert.equal(missing.status, 403);
  });
});
