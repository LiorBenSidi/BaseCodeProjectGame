// The Match actor folder is self-contained (the deploy uploads only files under it), so the
// simulation core and session layer are copied there by base44/tools/sync-actor.mjs. These tests
// make an out-of-sync copy, or a platform-incompatible import, a failing dry run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff, SYNCED_FILES } from '../../base44/tools/sync-actor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTOR = path.join(ROOT, 'base44', 'actors', 'Match');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

test('every synced copy is byte-identical to its src/ original', () => {
  const d = diff();
  assert.deepEqual(d, [], `run: node base44/tools/sync-actor.mjs\n${JSON.stringify(d, null, 2)}`);
});

test('the sync list covers all of src/shared and the whole GameRoom import closure', () => {
  const shared = fs.readdirSync(path.join(ROOT, 'src', 'shared')).filter((f) => f.endsWith('.js'));
  const synced = new Set(SYNCED_FILES.map(([src]) => src));
  for (const f of shared) assert.ok(synced.has(`src/shared/${f}`), `src/shared/${f} is not synced`);
  for (const f of ['GameRoom.js', 'protocol.js', 'security.js', 'rateLimit.js', 'logger.js', 'matchSession.js']) {
    assert.ok(synced.has(`src/server/${f}`), `src/server/${f} is not synced`);
  }
});

test('actor sources use no Deno, no node: builtins, no bare npm imports (CFW scanner rules)', () => {
  for (const file of walk(ACTOR).filter((f) => /\.(js|ts)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.doesNotMatch(text, /\bDeno\s*\./, `${rel} references Deno`);
    for (const m of text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      const ok = spec.startsWith('./') || spec.startsWith('../') || spec === 'base44:runtime/actors';
      assert.ok(ok, `${rel} imports "${spec}", which the actor bundle cannot resolve`);
    }
  }
});

test('only entry.ts is named entry under the actor folder (helpers must not be)', () => {
  const entries = walk(ACTOR).filter((f) => /(^|\/)entry\.(ts|js)$/.test(f));
  assert.deepEqual(entries.map((f) => path.relative(ACTOR, f)), ['entry.ts']);
});

test('entry.ts default-exports a class extending Actor and sets the tick interval from TICK_RATE', () => {
  const text = fs.readFileSync(path.join(ACTOR, 'entry.ts'), 'utf8');
  assert.match(text, /import \{ Actor \} from "base44:runtime\/actors"/);
  assert.match(text, /export default class \w+ extends Actor/);
  assert.match(text, /tickIntervalMs = 1000 \/ TICK_RATE/);
  for (const hook of ['handleStart', 'shouldTick', 'handleConnect', 'handleMessage', 'handleTick', 'handleClose', 'handleWake']) {
    assert.match(text, new RegExp(`\\b${hook}\\(`), `entry.ts lacks ${hook}`);
  }
  // SPEC 17.3 clock: the heartbeat is a platform schedule, the steps run in host.advance().
  assert.match(text, /const CLOCK_KEY = "clock"/, 'entry.ts does not name the clock schedule key');
  assert.match(text, /this\.schedule\(CLOCK_KEY, /, 'entry.ts does not arm the clock schedule');
  assert.match(text, /host\.advance\(\)/, 'entry.ts does not advance the clock');
  // Every hook body runs under the guard, and the schedule call is guarded too (hook errors are silent upstream).
  for (const hook of ['start', 'connect', 'message', 'tick', 'close', 'wake']) {
    assert.match(text, new RegExp(`this\\.guard\\("${hook}", `), `entry.ts hook ${hook} is not guarded`);
  }
  assert.match(text, /this\.host\.fail\("schedule", /, 'entry.ts does not report a failed schedule');
  // SPEC 17.3 diagnostics: gated by the room id (app secrets never reach a deployed actor), build marker in the probe.
  assert.match(text, /diag: isDiagRoom\(this\.instanceId\)/, 'entry.ts does not gate diagnostics on the room id');
  assert.match(text, /export const ACTOR_BUILD = "\d+\.\d+"/, 'entry.ts does not carry a build marker');
  assert.match(text, /build: ACTOR_BUILD/, 'entry.ts does not put the build marker in the probe');
  assert.doesNotMatch(text, /ACTOR_DIAG|secrets/, 'entry.ts still reads an app secret for diagnostics');
});

test('entry.ts never reads this.instanceId / this.name from a class field initializer (runtime sets them after construction)', () => {
  const text = fs.readFileSync(path.join(ACTOR, 'entry.ts'), 'utf8');
  const classBody = text.slice(text.indexOf('extends Actor {'));
  for (const line of classBody.split('\n')) {
    if (/^\s+#?\w+(\s*:\s*[^=]+)?\s*=\s*.*this\./.test(line)) {
      assert.fail(`field initializer touches this: ${line.trim()}`);
    }
  }
});
