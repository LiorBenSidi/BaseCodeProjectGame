#!/usr/bin/env node
// Zero-dependency lint + security policy gate. Runs locally (pre-commit hook) and in CI.
//
// It is a *lexical* checker (the ITS4/Flawfinder tier of static analysis): fast, no install, and it
// catches the bug classes we have decided are never acceptable. The semantic tier (data-flow /
// taint tracking) is CodeQL, which runs in .github/workflows/codeql.yml.
//
// Suppress a finding on one line with:   // policy-allow: RULE_ID because <reason>
// (explicit and reviewable, like `# noqa`).
//
// Usage:  node scripts/check-policy.mjs [--no-syntax]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RULES = [
  {
    id: 'NO_CONSOLE_SERVER',
    scope: /^src\/(server|shared)\//,
    pattern: /\bconsole\s*\./,
    why: 'Use the structured logger (src/server/logger.js). console.* is unlevelled, unstructured and forgeable.',
  },
  {
    id: 'NO_CONSOLE_LOG_CLIENT',
    scope: /^src\/client\//,
    pattern: /\bconsole\s*\.\s*log\b/,
    why: 'Remove debug logging before committing (console.warn / console.error are allowed).',
  },
  {
    id: 'NO_HTML_SINK',
    scope: /^src\/client\//,
    pattern: /\.(innerHTML|outerHTML)\b|\binsertAdjacentHTML\b|\bdocument\s*\.\s*write(ln)?\b/,
    why: 'XSS sink. Build DOM nodes and set textContent; player names are attacker-controlled.',
  },
  {
    id: 'NO_DYNAMIC_CODE',
    scope: /^src\//,
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/,
    why: 'Dynamic code execution mixes data and code (the root cause of injection).',
  },
  {
    id: 'NO_SHELL_EXEC',
    scope: /^src\//,
    pattern: /\bchild_process\b/,
    why: 'The game server has no reason to spawn processes; if this changes, review it explicitly.',
  },
  {
    id: 'NO_HARDCODED_SECRET',
    scope: /^src\//,
    pattern: /\w*(api[_-]?key|secret|token|passw(or)?d)\w*\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i,
    why: 'Secrets belong in environment variables / CI secrets, never in source.',
  },
  {
    id: 'NO_WILDCARD_REEXPORT',
    scope: /^src\//,
    pattern: /\bexport\s*\*\s*(as\s+\w+\s*)?from\b/,
    why: 'Wildcard re-exports hide where names come from (course rule: no wildcard imports).',
  },
];

const ALLOW = /policy-allow:\s*([A-Z_]+)/;

// Remove comments so a comment that *mentions* a banned API does not trip the rule.
// Line comments are only stripped when `//` is not part of "://" (URLs).
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const allow = line.match(ALLOW);
      const stripped = line.replace(/(^|[^:])\/\/.*$/, '$1');
      return allow ? `${stripped} /*${allow[0]}*/` : stripped;
    })
    .join('\n');
}

// Returns [{ file, line, rule, why }] for one source file. `file` must be repo-relative, POSIX-style.
export function scanSource(file, text) {
  const findings = [];
  const lines = stripComments(text).split('\n');
  lines.forEach((line, i) => {
    const allowed = line.match(ALLOW)?.[1];
    for (const rule of RULES) {
      if (!rule.scope.test(file) || !rule.pattern.test(line)) continue;
      if (allowed === rule.id) continue;
      findings.push({ file, line: i + 1, rule: rule.id, why: rule.why });
    }
  });
  return findings;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const skipSyntax = process.argv.includes('--no-syntax');
  const files = walk(path.join(root, 'src'));
  if (files.length === 0) {
    process.stderr.write('policy check found 0 source files: refusing to report a false green\n');
    process.exit(2);
  }

  let failures = 0;
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!skipSyntax) {
      try {
        execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
      } catch (err) {
        failures += 1;
        process.stderr.write(`${rel}: SYNTAX ERROR\n${String(err.stderr)}\n`);
        continue;
      }
    }
    for (const f of scanSource(rel, fs.readFileSync(abs, 'utf8'))) {
      failures += 1;
      process.stderr.write(`${f.file}:${f.line}  ${f.rule}  ${f.why}\n`);
    }
  }
  if (failures > 0) {
    process.stderr.write(`\npolicy check FAILED: ${failures} problem(s)\n`);
    process.exit(1);
  }
  process.stdout.write(`policy check OK (${files.length} files)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
