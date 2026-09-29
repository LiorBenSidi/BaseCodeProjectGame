// SPEC section 12 (HTTP part): health endpoints, 404/405, security headers in dev vs prod, close().
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, httpRequest, startTestServer, tryConnect, withTimeout } from '../helpers/harness.js';

const PROD_CSP_PARTS = ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"];

function assertSecurityHeaders(res, isProd, label) {
  const h = res.headers;
  assert.equal(h['x-content-type-options'], 'nosniff', `${label}: nosniff`);
  assert.equal(h['referrer-policy'], 'no-referrer', `${label}: referrer-policy`);
  assert.equal(h['cross-origin-opener-policy'], 'same-origin', `${label}: COOP`);
  if (isProd) {
    assert.equal(h['x-frame-options'], 'DENY', `${label}: x-frame-options`);
    const csp = h['content-security-policy'];
    assert.ok(csp, `${label}: CSP present in prod`);
    for (const part of PROD_CSP_PARTS) assert.ok(csp.includes(part), `${label}: CSP contains ${part} (got: ${csp})`);
  } else {
    assert.equal(h['x-frame-options'], undefined, `${label}: no X-Frame-Options in dev`);
    assert.equal(h['content-security-policy'], undefined, `${label}: no CSP in dev`);
  }
}

for (const isProd of [false, true]) {
  describe(`HTTP endpoints (isProd=${isProd})`, () => {
    const ctx = useServer({ isProd });

    it('GET /healthz returns 200 JSON, no-store', async () => {
      const res = await httpRequest(ctx.port, { path: '/healthz' });
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /^application\/json/);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.deepEqual(JSON.parse(res.text), { status: 'ok' });
    });

    it('GET /readyz returns ready with player count 0 on an idle server', async () => {
      const res = await httpRequest(ctx.port, { path: '/readyz' });
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /^application\/json/);
      assert.deepEqual(JSON.parse(res.text), { status: 'ready', players: 0 });
    });

    it('query strings are ignored when matching /healthz and /readyz', async () => {
      const a = await httpRequest(ctx.port, { path: '/healthz?probe=1&x=%20' });
      assert.equal(a.status, 200);
      assert.deepEqual(JSON.parse(a.text), { status: 'ok' });
      const b = await httpRequest(ctx.port, { path: '/readyz?a=b' });
      assert.equal(b.status, 200);
      assert.equal(JSON.parse(b.text).status, 'ready');
    });

    it('HEAD /healthz answers 200 with no body', async () => {
      const res = await httpRequest(ctx.port, { method: 'HEAD', path: '/healthz' });
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 0);
    });

    it('readyz reflects the number of joined players', async () => {
      const a = await ctx.open();
      const b = await ctx.open();
      const unjoined = await ctx.open();
      await a.join('A');
      await b.join('B');
      const res = await httpRequest(ctx.port, { path: '/readyz' });
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), { status: 'ready', players: 2 });
      assert.equal(unjoined.isOpen, true);
    });

    it('with client:none every other path is 404 (including prefix/suffix look-alikes of the health paths)', async () => {
      for (const path of ['/', '/nope', '/favicon.ico', '/health', '/healthz2', '/xhealthz', '/readyz/x', '/index.html', '/assets/x.js']) {
        const res = await httpRequest(ctx.port, { path });
        assert.equal(res.status, 404, `GET ${path}`);
      }
      const head = await httpRequest(ctx.port, { method: 'HEAD', path: '/nope' });
      assert.equal(head.status, 404);
    });

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      it(`${method} on any path is 405 with Allow: GET, HEAD`, async () => {
        for (const path of ['/healthz', '/readyz', '/nope', '/ws', '/']) {
          const res = await httpRequest(ctx.port, { method, path });
          assert.equal(res.status, 405, `${method} ${path}`);
          assert.equal(res.headers['allow'], 'GET, HEAD', `${method} ${path} Allow header`);
        }
      });
    }

    it('every response type carries the security headers (and CSP/XFO only in prod)', async () => {
      const responses = {
        'GET /healthz': await httpRequest(ctx.port, { path: '/healthz' }),
        'HEAD /healthz': await httpRequest(ctx.port, { method: 'HEAD', path: '/healthz' }),
        'GET /readyz': await httpRequest(ctx.port, { path: '/readyz' }),
        'GET /missing (404)': await httpRequest(ctx.port, { path: '/missing' }),
        'POST /healthz (405)': await httpRequest(ctx.port, { method: 'POST', path: '/healthz' }),
        'DELETE /missing (405)': await httpRequest(ctx.port, { method: 'DELETE', path: '/missing' }),
      };
      assert.equal(responses['GET /missing (404)'].status, 404);
      assert.equal(responses['POST /healthz (405)'].status, 405);
      for (const [label, res] of Object.entries(responses)) assertSecurityHeaders(res, isProd, label);
    });
  });
}

describe('startServer / close()', () => {
  it('binds an ephemeral port, close() resolves even with an open socket, then the port refuses connections', async () => {
    const t = await startTestServer();
    assert.ok(Number.isInteger(t.port) && t.port > 0 && t.port < 65536, `real port returned, got ${t.port}`);
    const r = await tryConnect(t.port);
    assert.equal(r.ok, true);
    try {
      await withTimeout(t.close(), 8000, 'server.close() with an open websocket');
      await assert.rejects(httpRequest(t.port, { path: '/healthz', timeoutMs: 2000 }), (e) => e.code === 'ECONNREFUSED');
    } finally {
      r.client.dispose();
    }
  });

  it('two servers on port 0 get different ports and independent rooms', async () => {
    const a = await startTestServer();
    const b = await startTestServer();
    try {
      assert.notEqual(a.port, b.port);
      assert.notEqual(a.room, b.room);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
