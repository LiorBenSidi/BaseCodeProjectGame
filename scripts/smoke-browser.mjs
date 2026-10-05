#!/usr/bin/env node
// Headless browser smoke driver (SPEC 36.8, D-035). Drives the built client in Chrome over the DevTools protocol
// with no extra dependency: a JSON list of steps ({emulate, goto, eval, sleep, shot, name}) from docs/smoke/; screenshots go to a
// fresh private temp directory printed at the end.
// Usage: PORT=8820 ALLOWED_ORIGINS=http://localhost:8820 NODE_ENV=production node src/server/index.js &
//        node scripts/smoke-browser.mjs docs/smoke/settings.json [http://host:port]
// Needs google-chrome on PATH (CHROME env overrides). The Node dev server hosts ONE deathmatch room, so range,
// TDM, ceremony and vote are verified against the live actor (pass the live URL as the second argument).
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Trust boundary (CodeQL alerts 2 to 4 on PR #35): the step file must live in the repo's docs/smoke/ folder,
// navigation only ever targets the base URL from argv plus an allow-listed path, screenshots go to a fresh
// private directory (mkdtemp, 0700) instead of a fixed /tmp path, and nothing from the page or the step file
// reaches the log before control characters are stripped.
const SMOKE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'smoke');
const stepsPath = path.resolve(process.argv[2] ?? '');
if (!stepsPath.startsWith(SMOKE_DIR + path.sep) || !stepsPath.endsWith('.json')) {
  console.error('steps file must be a .json inside docs/smoke/'); process.exit(2);
}
const base = new URL(process.argv[3] ?? 'http://localhost:8820');
if (base.protocol !== 'http:' && base.protocol !== 'https:') { console.error('base URL must be http or https'); process.exit(2); }
const SAFE_PATH = /^\/[A-Za-z0-9_\-./?=&%]*$/; // a relative path with a query string, no scheme, no host, no fragment
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const clean = (v, max = 600) => String(v ?? '').replace(/[\r\n]/g, ' ').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max); // no newlines or escapes in the log
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'), { mode: 0o700 });
const chrome = spawn(process.env.CHROME || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=9333', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 40 && !list; i++) { // Chrome can take a few seconds on a busy machine
  await new Promise((r) => setTimeout(r, 500));
  list = await fetch('http://127.0.0.1:9333/json').then((r) => r.json()).catch(() => null);
}
if (!list) { console.error('Chrome did not expose the DevTools port'); chrome.kill(); process.exit(2); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
const shot = async (name) => {
  if (!SAFE_NAME.test(name)) throw new Error('screenshot name must match [A-Za-z0-9_-]');
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, `${name}.png`), Buffer.from(r.result.data, 'base64'), { mode: 0o600 });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
// `goto` is the path to open on the base URL ("/" or "/?room=..."); the legacy full localhost URL maps to "/".
const gotoPath = (g) => {
  const p = g === true || g === 'http://localhost:8820/' ? '/' : String(g);
  if (!SAFE_PATH.test(p)) throw new Error(`goto must be a relative path, got ${clean(p, 80)}`);
  return p;
};
const steps = JSON.parse(fs.readFileSync(stepsPath, 'utf8'));
if (!Array.isArray(steps)) { console.error('steps file must be a JSON array'); process.exit(2); }
// `emulate: "phone"` switches the tab to a 390x844 touch device with a mobile user agent (DevTools Emulation domain),
// so docs/smoke/mobile.json can check the touch layout that D1 gates on device detection. `emulate: "desktop"` clears it.
const emulate = async (kind) => {
  if (kind === 'phone') {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  } else if (kind === 'landscape') {
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  } else if (kind === 'desktop') {
    await send('Emulation.clearDeviceMetricsOverride'); await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  } else throw new Error('emulate must be phone, landscape or desktop');
};
for (const s of steps) {
  if (s.emulate) await emulate(s.emulate);
  if (s.goto) { await send('Page.navigate', { url: new URL(gotoPath(s.goto), base).href }); await sleep(s.wait ?? 2500); }
  if (s.eval) { const v = await evalJs(s.eval); console.log(`[${clean(s.name ?? 'eval', 60)}]`, clean(typeof v === 'string' ? v : JSON.stringify(v))); }
  if (s.sleep) await sleep(s.sleep);
  if (s.shot) await shot(s.shot);
}
console.log('--- console ---'); for (const l of logs.slice(0, 40)) console.log(JSON.stringify(clean(l, 220))); // page console lines, quoted
console.log(`screenshots: ${shotDir}`);
chrome.kill(); process.exit(0);
