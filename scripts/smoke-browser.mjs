#!/usr/bin/env node
// Headless browser smoke driver (SPEC 36.8, D-035). Drives the built client in Chrome over the DevTools protocol
// with no extra dependency: a JSON list of steps ({goto, eval, sleep, shot, name}); screenshots go to /tmp/smoke.
// Usage: PORT=8820 ALLOWED_ORIGINS=http://localhost:8820 NODE_ENV=production node src/server/index.js &
//        node scripts/smoke-browser.mjs docs/smoke/settings.json [http://host:port]
// Needs google-chrome on PATH (CHROME env overrides). The Node dev server hosts ONE deathmatch room, so range,
// TDM, ceremony and vote are verified against the live actor (pass the live URL as the second argument).
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
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
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync('/tmp/smoke', { recursive: true }); fs.writeFileSync(`/tmp/smoke/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
const base = process.argv[3] ?? 'http://localhost:8820';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map((s) => (s.goto ? { ...s, goto: s.goto.replace('http://localhost:8820', base) } : s));
for (const s of steps) {
  if (s.goto) { await send('Page.navigate', { url: s.goto }); await sleep(s.wait ?? 2500); }
  if (s.eval) { const v = await evalJs(s.eval); console.log(`[${s.name ?? 'eval'}]`, typeof v === 'string' ? v.slice(0, 600) : JSON.stringify(v)?.slice(0, 600)); }
  if (s.sleep) await sleep(s.sleep);
  if (s.shot) await shot(s.shot);
}
console.log('--- console ---'); for (const l of logs.slice(0, 40)) console.log(l.slice(0, 220));
chrome.kill(); process.exit(0);
