#!/usr/bin/env node
// Runs the node:test suites under tests/<dir>. Refuses to pass when nothing was collected:
// a runner that finds 0 tests and exits 0 is a false green (the most dangerous kind of CI result).
//
// Usage:  node scripts/run-tests.mjs [unit|integration|system|security|stress|regression|latency|all] [--coverage]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const coverage = args.includes('--coverage');
const suite = args.find((a) => !a.startsWith('--')) ?? 'all';
const SUITES = ['unit', 'integration', 'system', 'security', 'stress', 'regression', 'latency'];

if (suite !== 'all' && !SUITES.includes(suite)) {
  process.stderr.write(`unknown suite "${suite}" (expected one of: ${SUITES.join(', ')}, all)\n`);
  process.exit(2);
}

function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const dirs = (suite === 'all' ? SUITES : [suite]).map((s) => path.join(root, 'tests', s));
const files = dirs.flatMap((d) => collect(d)).sort();
if (files.length === 0) {
  process.stderr.write(`no test files found for "${suite}": refusing to report a false green\n`);
  process.exit(1);
}

const nodeArgs = ['--test', ...(coverage ? ['--experimental-test-coverage'] : []), ...files];
const result = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
