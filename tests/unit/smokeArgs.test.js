import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercises the CLI argument parsing of scripts/smoke.mjs as a black box. The URL points at a closed
// local port, so a correctly parsed run starts the smoke test and fails fast (exit 1), while a
// usage error exits 2 before any network access.
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/smoke.mjs');
const URL_ = 'http://127.0.0.1:1';
const USAGE = /^usage: /m;

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20000 });
}

test('smoke: URL is found when --origin is absent', () => {
  const r = run(URL_);
  assert.doesNotMatch(r.stderr, USAGE);
  assert.match(r.stdout, new RegExp(`smoke test against ${URL_}`));
  assert.strictEqual(r.status, 1);
});

test('smoke: URL after --origin <value> is found', () => {
  const r = run('--origin', 'http://example.test', URL_);
  assert.doesNotMatch(r.stderr, USAGE);
  assert.match(r.stdout, new RegExp(`smoke test against ${URL_}`));
});

test('smoke: URL before --origin <value> is found', () => {
  const r = run(URL_, '--origin', 'http://example.test');
  assert.doesNotMatch(r.stderr, USAGE);
  assert.match(r.stdout, new RegExp(`smoke test against ${URL_}`));
});

test('smoke: --origin without a value prints usage and exits 2', () => {
  const r = run(URL_, '--origin');
  assert.match(r.stderr, USAGE);
  assert.strictEqual(r.status, 2);
});

test('smoke: no URL prints usage and exits 2', () => {
  const r = run();
  assert.match(r.stderr, USAGE);
  assert.strictEqual(r.status, 2);
});
