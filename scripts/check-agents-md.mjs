#!/usr/bin/env node
// Guards the owner-maintained region of AGENTS.md against being overwritten or trimmed, for example by an
// automated environment setup that writes to the same file. Exits non-zero if the markers or any required
// invariant are missing. Zero dependencies.
//
// Usage: node scripts/check-agents-md.mjs [path-to-AGENTS.md]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BEGIN = '<!-- OWNER-RULES:BEGIN';
export const END = '<!-- OWNER-RULES:END -->';

// Short, stable phrases, one per invariant. If an invariant is reworded on purpose, update it here in the same PR,
// and only with the owner's explicit approval (this file is one of the protected files listed in AGENTS.md).
export const REQUIRED_PHRASES = [
  'The server is authoritative',
  'deterministic simulation core',
  'parseClientMessage',
  'One port',
  'console.*',
  'textContent',
  'GameRoom',
  'Spec -> tests -> code',
  'ask, never assume',
  'Dry tests and live tests',
  'The author verifies',
  '"not run", never "passed"',
  'Secrets and configuration',
  'Protected files',
];

// Returns an array of human-readable problems (empty when the file is fine).
export function checkAgentsMd(text) {
  const problems = [];
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begin === -1) problems.push('missing OWNER-RULES:BEGIN marker');
  if (end === -1) problems.push('missing OWNER-RULES:END marker');
  if (begin === -1 || end === -1) return problems;
  if (end < begin) return ['OWNER-RULES:END appears before OWNER-RULES:BEGIN'];

  // Collapse whitespace so re-wrapping a line never causes a false alarm.
  const region = text.slice(begin, end).replace(/\s+/g, ' ');
  for (const phrase of REQUIRED_PHRASES) {
    if (!region.includes(phrase)) problems.push(`owner region no longer contains: "${phrase}"`);
  }
  return problems;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = process.argv[2] ?? path.join(root, 'AGENTS.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    process.stderr.write(`AGENTS.md check FAILED: cannot read ${file}\n`);
    process.exit(1);
  }
  const problems = checkAgentsMd(text);
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`AGENTS.md: ${p}\n`);
    process.stderr.write('AGENTS.md check FAILED: the owner-maintained rules were altered\n');
    process.exit(1);
  }
  process.stdout.write('AGENTS.md check OK\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
