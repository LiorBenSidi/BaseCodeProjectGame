#!/usr/bin/env node
// Copies the simulation core and the session layer into the Match actor folder.
//
// `npx base44 actors deploy` uploads only the files inside base44/actors/<Name>/, so the actor
// cannot import ../../src. Instead of a second copy that drifts, the files under
// base44/actors/Match/{shared,server} are generated from src/ by this script and verified by
// tests/unit/actorBundle.test.js (which fails when either side was edited alone).
//
//   node base44/tools/sync-actor.mjs          # write the copies
//   node base44/tools/sync-actor.mjs --check  # exit 1 if any copy differs from src/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTOR = path.join(ROOT, 'base44', 'actors', 'Match');

// Every file the actor needs, as [source relative to repo root, destination relative to actor folder].
// GameRoom imports '../shared/*', so server/ and shared/ stay siblings inside the actor folder too.
export const SYNCED_FILES = [
  ['src/server/GameRoom.js', 'server/GameRoom.js'],
  ['src/server/logger.js', 'server/logger.js'],
  ['src/server/matchSession.js', 'server/matchSession.js'],
  ['src/server/protocol.js', 'server/protocol.js'],
  ['src/server/rateLimit.js', 'server/rateLimit.js'],
  ['src/server/security.js', 'server/security.js'],
  ...fs.readdirSync(path.join(ROOT, 'src', 'shared'))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => [`src/shared/${f}`, `shared/${f}`]),
];

export function diff() {
  const out = [];
  for (const [src, dst] of SYNCED_FILES) {
    const a = fs.readFileSync(path.join(ROOT, src), 'utf8');
    const dstPath = path.join(ACTOR, dst);
    const b = fs.existsSync(dstPath) ? fs.readFileSync(dstPath, 'utf8') : null;
    if (a !== b) out.push({ src, dst, missing: b === null });
  }
  return out;
}

export function sync() {
  for (const [src, dst] of SYNCED_FILES) {
    const dstPath = path.join(ACTOR, dst);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), dstPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const d = diff();
    for (const f of d) process.stderr.write(`${f.dst} ${f.missing ? 'missing' : 'differs from'} ${f.src}\n`);
    process.exit(d.length === 0 ? 0 : 1);
  } else {
    sync();
    process.stdout.write(`synced ${SYNCED_FILES.length} files into base44/actors/Match\n`);
  }
}
