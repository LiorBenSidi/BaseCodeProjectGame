#!/usr/bin/env node
// LIVE probe of the deployed Match actor from Node, over the Base44 SDK. Read-only for the app: it joins one
// room as a player named "probe", counts the frames that arrive and leaves. See docs/LIVE_TESTING.md.
//
// Usage:
//   node scripts/actor-probe.mjs <app-id> [room] [seconds] [--inputs] [--diag] [--proxy]
//
//   room      a real room on the live app; pick one no player uses (default probe-1)
//   seconds   how long to listen (default 8)
//   --inputs  stream 60 Hz input messages like a moving player (each one advances the room clock)
//   --diag    send { t: "diag" } twice, 400 ms apart, and print both answers; answered only in a diag-* room
//   --proxy   force the platform proxy transport instead of the direct WebSocket a browser uses
//
// Exit code 0 = at least one snapshot arrived, 1 = none did, 2 = bad usage.
//
// The SDK only sends X-Base44-Anonymous-Id when a `window` exists; without it the connection-token mint answers
// 422 and the SDK silently falls back to the proxy. A minimal window keeps this run on the browser's path.

export function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [appId, room = 'probe-1', secondsRaw = '8'] = positional;
  const seconds = Number(secondsRaw);
  if (!appId || !/^[0-9a-f]{24}$/.test(appId)) return { error: 'app-id must be a 24 character hex id' };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) return { error: 'room must match ^[A-Za-z0-9_-]{1,64}$' };
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) return { error: 'seconds must be between 1 and 120' };
  const known = new Set(['--inputs', '--diag', '--proxy']);
  for (const f of flags) if (!known.has(f)) return { error: `unknown flag ${f}` };
  return { appId, room, seconds, inputs: flags.has('--inputs'), diag: flags.has('--diag'), proxy: flags.has('--proxy') };
}

export function summarize({ counts, snapTimes, seconds }) {
  const gaps = snapTimes.slice(1).map((v, i) => v - snapTimes[i]).sort((a, b) => a - b);
  const q = (p) => (gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))]) : null);
  return { counts, snaps: snapTimes.length, snapsPerSec: +(snapTimes.length / seconds).toFixed(1), gapMs: { p50: q(0.5), p90: q(0.9), max: q(1) } };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write(`usage: node scripts/actor-probe.mjs <app-id> [room] [seconds] [--inputs] [--diag] [--proxy]\n${args.error}\n`);
    return 2;
  }
  const site = `https://base-code-arena-5fefcb78.base44.app/`;
  globalThis.window ??= { location: { href: site } };
  globalThis.localStorage ??= {
    store: new Map(),
    getItem(k) { return this.store.get(k) ?? null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
  };
  const { createClient } = await import('@base44/sdk');
  const client = createClient({ appId: args.appId, requiresAuth: false, actorsTransport: args.proxy ? 'proxy' : 'direct' });
  const conn = client.actors.Match(args.room).connect({ id: `probe-${Math.random().toString(36).slice(2, 10)}` });

  const t0 = performance.now();
  const counts = {};
  const snapTimes = [];
  const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
  log(`actor probe: app ${args.appId} room ${args.room} for ${args.seconds}s (${args.proxy ? 'proxy' : 'direct'} transport)`);
  conn.subscribe((msg) => {
    const t = msg?.t ?? 'unknown';
    counts[t] = (counts[t] ?? 0) + 1;
    const at = Math.round(performance.now() - t0);
    if (t === 'snap') {
      if (snapTimes.length === 0) log(`first snap at ${at} ms`);
      snapTimes.push(performance.now());
    } else if (t === 'welcome' || t === 'error' || t === 'rejoin' || t === 'diag') {
      log(`${t} at ${at} ms ${JSON.stringify(msg)}`);
    }
  });
  conn.send({ t: 'join', name: 'probe' });

  let seq = 0;
  const timers = [];
  if (args.inputs) {
    timers.push(setInterval(() => conn.send({ t: 'input', cmds: [{ seq: ++seq, fwd: 1, right: 0, jump: false, yaw: 0, pitch: 0 }] }), 1000 / 60));
  }
  if (args.diag) {
    timers.push(setTimeout(() => conn.send({ t: 'diag' }), 1500));
    timers.push(setTimeout(() => conn.send({ t: 'diag' }), 1900));
  }
  await new Promise((r) => setTimeout(r, args.seconds * 1000));
  for (const h of timers) clearInterval(h);
  log(JSON.stringify(summarize({ counts, snapTimes, seconds: args.seconds })));
  conn.close();
  return snapTimes.length > 0 ? 0 : 1;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('actor-probe.mjs')) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { process.stderr.write(`${err?.stack ?? err}\n`); process.exit(1); });
}
