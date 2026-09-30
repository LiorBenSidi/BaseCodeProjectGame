#!/usr/bin/env node
// LIVE smoke test against a RUNNING server: your local dev server, a production build, or a hosted preview URL
// (for example the Base Code preview). Read-only HTTP (GET) plus one short WebSocket session.
//
// Usage:
//   node scripts/smoke.mjs http://localhost:3000
//   node scripts/smoke.mjs https://<preview-host> --origin https://<preview-host>
//
// Exit code 0 = every check passed, 1 = a check failed, 2 = bad usage.
// It proves the deployed wiring (health, headers, WebSocket origin policy, join, input ack), not gameplay rules;
// the rules are covered by the unit and integration suites.

import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = predicate();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
    await sleep(25);
  }
}

// Returns { ok, results: [{ name, ok, detail }] }. Never throws for a failing check.
export async function runSmoke({ baseUrl, origin, timeoutMs = 8000 }) {
  const results = [];
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail ?? '' });
    } catch (err) {
      results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const base = new URL(baseUrl);
  const wsUrl = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/ws`;
  const sendOrigin = origin ?? base.origin;

  await check('GET /healthz returns 200 {"status":"ok"}', async () => {
    const res = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json();
    if (res.status !== 200 || body.status !== 'ok') throw new Error(`status ${res.status}, body ${JSON.stringify(body)}`);
    if (res.headers.get('x-content-type-options') !== 'nosniff') throw new Error('missing X-Content-Type-Options: nosniff');
    return `status ${res.status}`;
  });

  await check('GET /readyz returns 200 with a player count', async () => {
    const res = await fetch(new URL('/readyz', base), { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json();
    if (res.status !== 200 || !Number.isInteger(body.players)) throw new Error(`status ${res.status}, body ${JSON.stringify(body)}`);
    return `${body.players} player(s) connected`;
  });

  await check('GET / serves the game page', async () => {
    const res = await fetch(base, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (res.status !== 200 || !text.includes('Base Code Arena')) throw new Error(`status ${res.status}, page title not found`);
    return `status ${res.status}`;
  });

  // One WebSocket session: join, receive welcome and snapshots, send input, see it acknowledged.
  const messages = [];
  let ws;
  await check(`WebSocket ${wsUrl} accepts Origin ${sendOrigin}`, async () => {
    ws = new WebSocket(wsUrl, { headers: { Origin: sendOrigin }, handshakeTimeout: timeoutMs });
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(String(data))); } catch { /* ignore non-JSON */ }
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('unexpected-response', (_req, res) => {
        const hint = res.statusCode === 403
          ? ' (Origin refused: set ALLOWED_ORIGINS on the server to this exact origin)'
          : res.statusCode === 429 ? ' (too many connections from this address)' : '';
        reject(new Error(`HTTP ${res.statusCode} instead of a WebSocket upgrade${hint}`));
      });
      ws.once('error', (e) => reject(new Error(`connection error: ${e.message}`)));
    });
    return 'upgrade accepted';
  });

  if (ws && ws.readyState === WebSocket.OPEN) {
    const name = `smoke-${Math.floor(Math.random() * 9000 + 1000)}`;
    let myId = null;

    await check('join -> welcome {id, tickRate}', async () => {
      ws.send(JSON.stringify({ t: 'join', name }));
      const welcome = await waitFor(() => messages.find((m) => m.t === 'welcome'), timeoutMs, 'welcome');
      if (!Number.isInteger(welcome.id) || !Number.isInteger(welcome.tickRate)) throw new Error(`bad welcome ${JSON.stringify(welcome)}`);
      myId = welcome.id;
      return `id ${welcome.id}, tickRate ${welcome.tickRate}`;
    });

    await check('snapshots list this player at full health', async () => {
      const snap = await waitFor(() => messages.find((m) => m.t === 'snap' && m.players?.some((p) => p.id === myId)), timeoutMs, 'a snapshot');
      const me = snap.players.find((p) => p.id === myId);
      if (me.name !== name || me.hp !== 100 || me.alive !== 1) throw new Error(`unexpected player ${JSON.stringify(me)}`);
      return `tick ${snap.tick}`;
    });

    await check('input commands are acknowledged by the server', async () => {
      const cmds = [1, 2, 3].map((seq) => ({ seq, fwd: 1, right: 0, jump: false, yaw: 0, pitch: 0 }));
      ws.send(JSON.stringify({ t: 'input', cmds }));
      const snap = await waitFor(() => messages.filter((m) => m.t === 'snap').find((m) => m.ack >= 3), timeoutMs, 'ack >= 3');
      return `ack ${snap.ack}`;
    });

    ws.close();
  }

  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  const args = process.argv.slice(2);
  const originIdx = args.indexOf('--origin');
  const origin = originIdx >= 0 ? args[originIdx + 1] : undefined;
  const baseUrl = args.find((a, i) => !a.startsWith('--') && (originIdx < 0 || i !== originIdx + 1));
  if (!baseUrl || !/^https?:\/\//.test(baseUrl) || (originIdx >= 0 && !origin)) {
    process.stderr.write('usage: node scripts/smoke.mjs <http(s)://host[:port]> [--origin <origin>]\n');
    process.exit(2);
  }
  process.stdout.write(`smoke test against ${baseUrl}\n`);
  const { ok, results } = await runSmoke({ baseUrl, origin });
  for (const r of results) process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}\n`);
  process.stdout.write(ok ? 'smoke test PASSED\n' : 'smoke test FAILED\n');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
