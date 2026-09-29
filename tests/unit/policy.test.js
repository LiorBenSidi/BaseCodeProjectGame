import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, stripComments, scanSource } from '../../scripts/check-policy.mjs';

const SERVER = 'src/server/x.js';
const SHARED = 'src/shared/x.js';
const CLIENT = 'src/client/x.js';
const ids = (file, text) => scanSource(file, text).map((f) => f.rule);
const has = (file, text, rule) => ids(file, text).includes(rule);
const count = (s, ch) => s.split(ch).length - 1;

const ALL = [
  'NO_CONSOLE_SERVER', 'NO_CONSOLE_LOG_CLIENT', 'NO_HTML_SINK', 'NO_DYNAMIC_CODE',
  'NO_SHELL_EXEC', 'NO_HARDCODED_SECRET', 'NO_WILDCARD_REEXPORT',
];

// ---- exports / shape ----
test('RULES is exported and non-empty', () => {
  assert.ok(RULES && typeof RULES === 'object');
});
test('RULES mentions every documented rule id', () => {
  const s = JSON.stringify(Array.isArray(RULES) ? RULES.map((x) => x.id ?? x.rule ?? x.name ?? x) : Object.keys(RULES));
  for (const id of ALL) assert.ok(s.includes(id), id);
});
test('stripComments and scanSource are functions', () => {
  assert.equal(typeof stripComments, 'function');
  assert.equal(typeof scanSource, 'function');
});
test('clean source yields empty array', () => {
  assert.deepEqual(scanSource(SERVER, 'export const a = 1;\n'), []);
});
test('finding has file, 1-based line, rule and non-empty why', () => {
  const f = scanSource(SERVER, 'const a = 1;\nconsole.log(a);\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].file, SERVER);
  assert.equal(f[0].line, 2);
  assert.equal(f[0].rule, 'NO_CONSOLE_SERVER');
  assert.equal(typeof f[0].why, 'string');
  assert.ok(f[0].why.length > 0);
});
test('first line is reported as line 1', () => {
  assert.equal(scanSource(SERVER, 'console.log(1)')[0].line, 1);
});

// ---- NO_CONSOLE_SERVER ----
test('NO_CONSOLE_SERVER flags console.log in src/server', () => {
  assert.deepEqual(ids(SERVER, 'console.log("a");'), ['NO_CONSOLE_SERVER']);
});
test('NO_CONSOLE_SERVER flags console.error in src/server', () => {
  assert.ok(has(SERVER, 'console.error(e);', 'NO_CONSOLE_SERVER'));
});
test('NO_CONSOLE_SERVER flags console.warn in src/server', () => {
  assert.ok(has(SERVER, 'console.warn(e);', 'NO_CONSOLE_SERVER'));
});
test('NO_CONSOLE_SERVER flags console.table (anything) in src/server', () => {
  assert.ok(has(SERVER, 'console.table(x);', 'NO_CONSOLE_SERVER'));
});
test('NO_CONSOLE_SERVER flags spaced "console . error("', () => {
  assert.ok(has(SERVER, 'console . error(e);', 'NO_CONSOLE_SERVER'));
});
test('NO_CONSOLE_SERVER flags src/shared', () => {
  assert.ok(has(SHARED, 'console.log(1);', 'NO_CONSOLE_SERVER'));
});
test('NO_CONSOLE_SERVER flags nested src/server/sub/file.js', () => {
  assert.ok(has('src/server/sub/y.js', 'console.log(1);', 'NO_CONSOLE_SERVER'));
});
test('NO_CONSOLE_SERVER near miss: identifier consoleLog( is fine', () => {
  assert.deepEqual(ids(SERVER, 'consoleLog(1);'), []);
});
test('NO_CONSOLE_SERVER near miss: logger.info is fine', () => {
  assert.deepEqual(ids(SERVER, 'logger.info("x");'), []);
});
test('NO_CONSOLE_SERVER near miss: word console inside a string without dot-use is not code use', () => {
  assert.equal(has(SERVER, 'const consoleWidth = 80;', 'NO_CONSOLE_SERVER'), false);
});
test('NO_CONSOLE_SERVER not applied to src/client', () => {
  assert.equal(has(CLIENT, 'console.log(1);', 'NO_CONSOLE_SERVER'), false);
});
test('NO_CONSOLE_SERVER not applied to tests/', () => {
  assert.deepEqual(scanSource('tests/a.js', 'console.log(1);'), []);
});

// ---- NO_CONSOLE_LOG_CLIENT ----
test('NO_CONSOLE_LOG_CLIENT flags console.log in src/client', () => {
  assert.deepEqual(ids(CLIENT, 'console.log("a");'), ['NO_CONSOLE_LOG_CLIENT']);
});
test('NO_CONSOLE_LOG_CLIENT allows console.warn', () => {
  assert.deepEqual(ids(CLIENT, 'console.warn("a");'), []);
});
test('NO_CONSOLE_LOG_CLIENT allows console.error', () => {
  assert.deepEqual(ids(CLIENT, 'console.error("a");'), []);
});
test('NO_CONSOLE_LOG_CLIENT near miss: console.logger is not console.log call... only flagged if spec-consistent', () => {
  // "console.log" only; an unrelated identifier must not match
  assert.deepEqual(ids(CLIENT, 'const myconsole = {}; myconsole.info(1);'), []);
});
test('NO_CONSOLE_LOG_CLIENT not applied to src/server', () => {
  assert.equal(has(SERVER, 'console.log(1);', 'NO_CONSOLE_LOG_CLIENT'), false);
});
test('NO_CONSOLE_LOG_CLIENT not applied to src/shared', () => {
  assert.equal(has(SHARED, 'console.log(1);', 'NO_CONSOLE_LOG_CLIENT'), false);
});

// ---- NO_HTML_SINK ----
for (const [label, code] of [
  ['.innerHTML', 'el.innerHTML = x;'],
  ['.outerHTML', 'el.outerHTML = x;'],
  ['insertAdjacentHTML', 'el.insertAdjacentHTML("beforeend", x);'],
  ['document.write', 'document.write(x);'],
  ['document.writeln', 'document.writeln(x);'],
]) {
  test(`NO_HTML_SINK flags ${label} in src/client`, () => {
    assert.ok(has(CLIENT, code, 'NO_HTML_SINK'));
  });
  test(`NO_HTML_SINK does not apply to server for ${label}`, () => {
    assert.equal(has(SERVER, code, 'NO_HTML_SINK'), false);
  });
}
for (const [label, code] of [
  ['textContent', 'el.textContent = x;'],
  ['createElement', 'document.createElement("div");'],
  ['append', 'el.append(child);'],
]) {
  test(`NO_HTML_SINK near miss: ${label} is fine`, () => {
    assert.deepEqual(ids(CLIENT, code), []);
  });
}
test('NO_HTML_SINK not applied to src/shared', () => {
  assert.equal(has(SHARED, 'el.innerHTML = x;', 'NO_HTML_SINK'), false);
});
test('NO_HTML_SINK not applied to tests/', () => {
  assert.deepEqual(scanSource('tests/a.js', 'el.innerHTML = x;'), []);
});

// ---- NO_DYNAMIC_CODE ----
for (const [label, code] of [
  ['eval(', 'eval(x);'],
  ['new Function(', 'const f = new Function("return 1");'],
  ['setTimeout with string (double quotes)', 'setTimeout("doIt()", 10);'],
  ['setTimeout with string (single quotes)', "setTimeout('doIt()', 10);"],
  ['setInterval with string', 'setInterval("tick()", 10);'],
]) {
  for (const [dir, file] of [['server', SERVER], ['client', CLIENT], ['shared', SHARED]]) {
    test(`NO_DYNAMIC_CODE flags ${label} in ${dir}`, () => {
      assert.ok(has(file, code, 'NO_DYNAMIC_CODE'));
    });
  }
}
test('NO_DYNAMIC_CODE near miss: retrieval( is fine', () => {
  assert.deepEqual(ids(SERVER, 'retrieval(x);'), []);
});
test('NO_DYNAMIC_CODE near miss: medieval( is fine', () => {
  assert.deepEqual(ids(SERVER, 'medieval(x);'), []);
});
test('NO_DYNAMIC_CODE near miss: setTimeout(fn, 10) is fine', () => {
  assert.deepEqual(ids(SERVER, 'setTimeout(fn, 10);'), []);
});
test('NO_DYNAMIC_CODE near miss: setInterval(() => x(), 10) is fine', () => {
  assert.deepEqual(ids(SERVER, 'setInterval(() => x(), 10);'), []);
});
test('NO_DYNAMIC_CODE near miss: new FunctionalThing( is fine', () => {
  assert.deepEqual(ids(SERVER, 'new FunctionalThing(1);'), []);
});
test('NO_DYNAMIC_CODE not applied to tests/', () => {
  assert.deepEqual(scanSource('tests/a.js', 'eval(x);'), []);
});
test('NO_DYNAMIC_CODE not applied to scripts/', () => {
  assert.deepEqual(scanSource('scripts/b.mjs', 'eval(x);'), []);
});

// ---- NO_SHELL_EXEC ----
test('NO_SHELL_EXEC flags import of child_process in server', () => {
  assert.ok(has(SERVER, "import { exec } from 'child_process';", 'NO_SHELL_EXEC'));
});
test('NO_SHELL_EXEC flags node:child_process', () => {
  assert.ok(has(SERVER, "import cp from 'node:child_process';", 'NO_SHELL_EXEC'));
});
test('NO_SHELL_EXEC flags require child_process', () => {
  assert.ok(has(SHARED, "const cp = require('child_process');", 'NO_SHELL_EXEC'));
});
test('NO_SHELL_EXEC flags client too (all of src)', () => {
  assert.ok(has(CLIENT, "import 'child_process';", 'NO_SHELL_EXEC'));
});
test('NO_SHELL_EXEC near miss: "child process" with a space is fine', () => {
  assert.deepEqual(ids(SERVER, 'const s = "child process";'), []);
});
test('NO_SHELL_EXEC near miss: childProcess camelCase is fine', () => {
  assert.deepEqual(ids(SERVER, 'const childProcess = 1;'), []);
});
test('NO_SHELL_EXEC not applied to scripts/', () => {
  assert.deepEqual(scanSource('scripts/b.mjs', "import 'node:child_process';"), []);
});

// ---- NO_HARDCODED_SECRET ----
test('NO_HARDCODED_SECRET flags apiKey with 12-char literal', () => {
  assert.ok(has(SERVER, 'const apiKey = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags api_key', () => {
  assert.ok(has(SERVER, "const api_key = 'abcd1234efgh';", 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags secret', () => {
  assert.ok(has(SERVER, 'const secret = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags token', () => {
  assert.ok(has(SERVER, 'const token = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags password', () => {
  assert.ok(has(SERVER, 'const password = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags identifier merely containing the word (authtoken)', () => {
  assert.ok(has(SERVER, 'const authtoken = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags object property assignment style with colon-free assignment', () => {
  assert.ok(has(SERVER, 'config.password = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET flags in client and shared (all of src)', () => {
  assert.ok(has(CLIENT, 'const token = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
  assert.ok(has(SHARED, 'const token = "abcd1234efgh";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET boundary: exactly 8 characters is flagged', () => {
  assert.ok(has(SERVER, 'const token = "12345678";', 'NO_HARDCODED_SECRET'));
});
test('NO_HARDCODED_SECRET boundary: 7 characters is fine', () => {
  assert.equal(has(SERVER, 'const token = "1234567";', 'NO_HARDCODED_SECRET'), false);
});
test('NO_HARDCODED_SECRET near miss: short literal is fine', () => {
  assert.deepEqual(ids(SERVER, 'const password = "x";'), []);
});
test('NO_HARDCODED_SECRET near miss: process.env read is fine', () => {
  assert.deepEqual(ids(SERVER, 'const apiKey = process.env.API_KEY;'), []);
});
test('NO_HARDCODED_SECRET near miss: process.env with fallback of nothing is fine', () => {
  assert.deepEqual(ids(SERVER, 'const token = process.env.TOKEN;'), []);
});
test('NO_HARDCODED_SECRET near miss: unrelated identifier with long literal is fine', () => {
  assert.deepEqual(ids(SERVER, 'const title = "a very long harmless literal";'), []);
});
test('NO_HARDCODED_SECRET not applied to tests/', () => {
  assert.deepEqual(scanSource('tests/a.js', 'const token = "abcd1234efgh";'), []);
});

// ---- NO_WILDCARD_REEXPORT ----
test('NO_WILDCARD_REEXPORT flags export * from', () => {
  assert.deepEqual(ids(SERVER, "export * from './a.js';"), ['NO_WILDCARD_REEXPORT']);
});
test('NO_WILDCARD_REEXPORT flags export * as ns from', () => {
  assert.deepEqual(ids(SERVER, "export * as ns from './a.js';"), ['NO_WILDCARD_REEXPORT']);
});
test('NO_WILDCARD_REEXPORT flags in client and shared', () => {
  assert.ok(has(CLIENT, "export * from './a.js';", 'NO_WILDCARD_REEXPORT'));
  assert.ok(has(SHARED, "export * from './a.js';", 'NO_WILDCARD_REEXPORT'));
});
test('NO_WILDCARD_REEXPORT near miss: import * as THREE is fine', () => {
  assert.deepEqual(ids(CLIENT, "import * as THREE from 'three';"), []);
});
test('NO_WILDCARD_REEXPORT near miss: named re-export is fine', () => {
  assert.deepEqual(ids(SERVER, "export { a, b } from './a.js';"), []);
});
test('NO_WILDCARD_REEXPORT near miss: multiplication in export const is fine', () => {
  assert.deepEqual(ids(SERVER, 'export const x = 2 * 3;'), []);
});
test('NO_WILDCARD_REEXPORT not applied to tests/', () => {
  assert.deepEqual(scanSource('tests/a.js', "export * from './a.js';"), []);
});

// ---- scope: outside src ----
for (const file of ['tests/a.js', 'scripts/b.mjs', 'vite.config.js', 'docs/x.js', 'a.js']) {
  test(`file outside src/ (${file}) produces no findings even with many violations`, () => {
    const bad = 'console.log(1);\neval(x);\nel.innerHTML=1;\nimport "child_process";\nconst token="abcd1234efgh";\nexport * from "./a.js";\n';
    assert.deepEqual(scanSource(file, bad), []);
  });
}

// ---- comments ----
test('line comment mentioning innerHTML is not a finding', () => {
  assert.deepEqual(ids(CLIENT, '// do not use innerHTML here\n'), []);
});
test('trailing line comment mentioning eval( is not a finding', () => {
  assert.deepEqual(ids(SERVER, 'const a = 1; // eval(x)\n'), []);
});
test('block comment mentioning console.log is not a finding', () => {
  assert.deepEqual(ids(SERVER, '/* console.log(1) */ const a = 1;'), []);
});
test('multi-line block comment content is not scanned', () => {
  assert.deepEqual(ids(CLIENT, '/*\n el.innerHTML = x;\n eval(y);\n*/\n'), []);
});
test('line numbers stay correct after a multi-line block comment', () => {
  const f = scanSource(CLIENT, '/* a\nb\nc\n*/\nel.innerHTML = x;\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 5);
});
test('line numbers stay correct after several comments', () => {
  const text = '// one\n/* two\nthree */\n// four\nconsole.log(1);\n';
  const f = scanSource(SERVER, text);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 5);
});
test('violation on the same line after a closing block comment is flagged at that line', () => {
  const f = scanSource(SERVER, '/* a\nb */ console.log(1);\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
});
test('URL http:// does not start a comment; later banned API on same line is flagged', () => {
  const f = scanSource(CLIENT, 'const u = "http://example.com"; el.innerHTML = u;\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'NO_HTML_SINK');
  assert.equal(f[0].line, 1);
});
test('URL https:// does not start a comment; eval later on the line is flagged', () => {
  assert.ok(has(SERVER, "const u = 'https://x.y/z'; eval(u);", 'NO_DYNAMIC_CODE'));
});
test('a real // comment after a URL still hides later text', () => {
  assert.deepEqual(ids(CLIENT, 'const u = "http://x"; // el.innerHTML = 1\n'), []);
});
test('banned API in code before a URL on the same line is flagged', () => {
  assert.ok(has(CLIENT, 'el.innerHTML = "http://x";', 'NO_HTML_SINK'));
});

// ---- suppression ----
test('same-line policy-allow suppresses the named rule', () => {
  assert.deepEqual(ids(CLIENT, 'el.innerHTML = x; // policy-allow: NO_HTML_SINK\n'), []);
});
test('policy-allow with wrong rule id does not suppress', () => {
  assert.ok(has(CLIENT, 'el.innerHTML = x; // policy-allow: NO_DYNAMIC_CODE\n', 'NO_HTML_SINK'));
});
test('policy-allow on a different line (above) has no effect', () => {
  const f = scanSource(CLIENT, '// policy-allow: NO_HTML_SINK\nel.innerHTML = x;\n');
  assert.deepEqual(f.map((x) => [x.rule, x.line]), [['NO_HTML_SINK', 2]]);
});
test('policy-allow on a different line (below) has no effect', () => {
  const f = scanSource(CLIENT, 'el.innerHTML = x;\n// policy-allow: NO_HTML_SINK\n');
  assert.deepEqual(f.map((x) => [x.rule, x.line]), [['NO_HTML_SINK', 1]]);
});
test('suppressing one rule on a line still reports another rule on that line', () => {
  const f = scanSource(CLIENT, 'eval("a"); el.innerHTML = 1; // policy-allow: NO_DYNAMIC_CODE\n');
  assert.deepEqual(f.map((x) => x.rule), ['NO_HTML_SINK']);
});
test('suppression on line 1 does not leak to a violation on line 2', () => {
  const f = scanSource(SERVER, 'console.log(1); // policy-allow: NO_CONSOLE_SERVER\nconsole.log(2);\n');
  assert.deepEqual(f.map((x) => x.line), [2]);
});
test('suppression works for a server rule too', () => {
  assert.deepEqual(ids(SERVER, 'console.log(1); // policy-allow: NO_CONSOLE_SERVER'), []);
});
test('policy-allow inside a block comment is not the documented // marker form (rule still applies or not, no crash)', () => {
  const f = scanSource(CLIENT, 'el.innerHTML = x; /* policy-allow: NO_HTML_SINK */\n');
  assert.ok(Array.isArray(f));
});

// ---- multiple findings ----
test('two different violations on one line give two findings on that line', () => {
  const f = scanSource(SERVER, 'console.log(1); eval("x");\n');
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.line), [1, 1]);
  assert.deepEqual(f.map((x) => x.rule).sort(), ['NO_CONSOLE_SERVER', 'NO_DYNAMIC_CODE']);
});
test('three rules on one client line give three findings', () => {
  const f = scanSource(CLIENT, 'console.log(1); el.innerHTML = eval("x");\n');
  assert.deepEqual(f.map((x) => x.rule).sort(), ['NO_CONSOLE_LOG_CLIENT', 'NO_DYNAMIC_CODE', 'NO_HTML_SINK']);
});
test('violations on separate lines report separate line numbers', () => {
  const f = scanSource(SERVER, 'console.log(1);\n\nconsole.log(2);\n');
  assert.deepEqual(f.map((x) => x.line), [1, 3]);
});
test('every finding carries the file it was scanned as', () => {
  const f = scanSource('src/server/deep/y.js', 'console.log(1);\neval(x);\n');
  for (const x of f) assert.equal(x.file, 'src/server/deep/y.js');
});

// ---- CRLF ----
test('CRLF line endings keep 1-based line numbers', () => {
  const f = scanSource(SERVER, 'a();\r\nb();\r\nconsole.log(1);\r\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 3);
});

// ---- stripComments ----
const SAMPLES = [
  '',
  'a',
  'a\nb\nc',
  '// x\n// y\n',
  '/* a\nb\nc */\nd',
  'x /* a\nb */ y // z\nw',
  'const u = "http://x"; // c\nnext',
  '/* one */ /* two\nthree */ four\n',
  'a\n\n\n/* \n\n */\n\nb\n',
  '/*\n*/\n/*\n*/\n',
];
for (const [i, s] of SAMPLES.entries()) {
  test(`stripComments preserves line count for sample ${i}`, () => {
    assert.equal(count(stripComments(s), '\n'), count(s, '\n'));
  });
}
test('stripComments removes line comment text', () => {
  assert.ok(!stripComments('a(); // secret marker\n').includes('secret marker'));
});
test('stripComments removes block comment text', () => {
  assert.ok(!stripComments('a(); /* hidden words */ b();').includes('hidden words'));
});
test('stripComments removes multi-line block comment text', () => {
  assert.ok(!stripComments('/* hidden\nwords */\nc();').includes('hidden'));
});
test('stripComments keeps code outside comments', () => {
  const out = stripComments('a(); // c\nb(); /* d */ c();');
  assert.ok(out.includes('a();') && out.includes('b();') && out.includes('c();'));
});
test('stripComments keeps http:// URL intact', () => {
  assert.ok(stripComments('const u = "http://x.y"; // c').includes('http://x.y'));
});
test('stripComments on comment-free text is identity', () => {
  const s = 'const a = 1;\nconst b = 2;\n';
  assert.equal(stripComments(s), s);
});
test('stripComments returns a string', () => {
  assert.equal(typeof stripComments('// x'), 'string');
});
