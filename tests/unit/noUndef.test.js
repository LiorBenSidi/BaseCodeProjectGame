// A used-but-never-imported identifier survives `vite build` and only explodes in the browser as a
// ReferenceError at startup (the 2026-10-03 TouchControls incident). ESLint's no-undef is the one
// static check that catches it, so the dry run owns it: this test runs the same config as `npm run lint`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('no file uses an identifier it never imports or declares (eslint no-undef)', async () => {
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(['src', 'base44', 'scripts', 'tests']);
  const problems = results.flatMap((r) =>
    r.messages.map((m) => `${path.relative(root, r.filePath)}:${m.line}:${m.column} ${m.message}`),
  );
  assert.deepEqual(problems, [], `undefined identifiers:\n${problems.join('\n')}`);
});
