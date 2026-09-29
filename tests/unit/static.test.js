import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStaticPath } from '../../src/server/static.js';

const ROOT = '/srv/app/dist';
const r = (u, root = ROOT) => resolveStaticPath(root, u);

function assertInsideOrNull(result, root = ROOT) {
  if (result === null) return;
  assert.equal(typeof result, 'string');
  assert.ok(result.startsWith(root.replace(/\/+$/, '') + '/'), `escaped root: ${result}`);
  assert.notEqual(result, root.replace(/\/+$/, ''));
  assert.ok(!result.split('/').includes('..'), `contains .. segment: ${result}`);
  assert.ok(!result.includes('\0'));
  assert.ok(!result.includes('\\'));
}

// ---- happy paths ----
test('root slash resolves to index.html', () => {
  assert.equal(r('/'), '/srv/app/dist/index.html');
});
test('empty string resolves to index.html', () => {
  assert.equal(r(''), '/srv/app/dist/index.html');
});
test('simple file resolves under root', () => {
  assert.equal(r('/index.html'), '/srv/app/dist/index.html');
});
test('nested file resolves under root', () => {
  assert.equal(r('/assets/app-1a2b.js'), '/srv/app/dist/assets/app-1a2b.js');
});
test('deeply nested path resolves', () => {
  assert.equal(r('/a/b/c/d.css'), '/srv/app/dist/a/b/c/d.css');
});
test('percent-encoded space is decoded', () => {
  assert.equal(r('/a%20b.txt'), '/srv/app/dist/a b.txt');
});
test('decoding happens exactly once (%2525 becomes literal %25)', () => {
  assert.equal(r('/100%2525.txt'), '/srv/app/dist/100%25.txt');
});
test('percent-encoded percent sign decodes to a single percent', () => {
  assert.equal(r('/100%25.txt'), '/srv/app/dist/100%.txt');
});
test('encoded unicode is decoded', () => {
  assert.equal(r('/caf%C3%A9.js'), '/srv/app/dist/café.js');
});
test('raw unicode path is accepted', () => {
  assert.equal(r('/café.js'), '/srv/app/dist/café.js');
});
test('CJK unicode path stays inside root', () => {
  assertInsideOrNull(r('/日本語/テスト.js'));
  assert.equal(r('/日本.js'), '/srv/app/dist/日本.js');
});

// ---- query / hash ----
test('query string is stripped', () => {
  assert.equal(r('/app.js?v=1'), '/srv/app/dist/app.js');
});
test('hash is stripped', () => {
  assert.equal(r('/app.js#frag'), '/srv/app/dist/app.js');
});
test('query then hash are both stripped', () => {
  assert.equal(r('/app.js?a=1#top'), '/srv/app/dist/app.js');
});
test('root with query resolves to index.html', () => {
  assert.equal(r('/?a=1'), '/srv/app/dist/index.html');
});
test('root with hash resolves to index.html', () => {
  assert.equal(r('/#x'), '/srv/app/dist/index.html');
});
test('traversal text inside the query string is ignored', () => {
  assert.equal(r('/app.js?q=/../../etc/passwd'), '/srv/app/dist/app.js');
});
test('traversal text inside the hash is ignored', () => {
  assert.equal(r('/app.js#/../../x'), '/srv/app/dist/app.js');
});
test('dotfile followed by query is still refused', () => {
  assert.equal(r('/.env?x=1'), null);
});

// ---- traversal ----
test('.. at start is refused', () => {
  assert.equal(r('/../package.json'), null);
});
test('bare /.. is refused', () => {
  assert.equal(r('/..'), null);
});
test('.. without leading slash is refused', () => {
  assert.equal(r('../package.json'), null);
});
test('.. in the middle escaping root is refused', () => {
  assert.equal(r('/a/../../package.json'), null);
});
test('.. at the end escaping root is refused', () => {
  assert.equal(r('/a/b/../../..'), null);
});
test('.. that returns exactly to root is refused (never equals root)', () => {
  assert.equal(r('/a/..'), null);
});
test('lowercase %2e%2e is refused', () => {
  assert.equal(r('/%2e%2e/package.json'), null);
});
test('uppercase %2E%2E is refused', () => {
  assert.equal(r('/%2E%2E/package.json'), null);
});
test('mixed-case %2e%2E is refused', () => {
  assert.equal(r('/%2e%2E/package.json'), null);
});
test('half-encoded .%2e is refused', () => {
  assert.equal(r('/.%2e/package.json'), null);
});
test('encoded slash after encoded dots (decoded once gives ../) is refused', () => {
  assert.equal(r('/%2e%2e%2fpackage.json'), null);
});
test('encoded dots in middle escaping root are refused', () => {
  assert.equal(r('/a/%2e%2e/%2e%2e/package.json'), null);
});
test('double-encoded dots never escape root', () => {
  assertInsideOrNull(r('/%252e%252e/package.json'));
});
test('double-encoded dots with double-encoded slash never escape root', () => {
  assertInsideOrNull(r('/%252e%252e%252fpackage.json'));
});
test('.. staying inside root may resolve normally or be refused, never escapes', () => {
  const res = r('/a/../b.js');
  assert.ok(res === null || res === '/srv/app/dist/b.js', String(res));
});
test('/./ segments never escape root', () => {
  const res = r('/a/./b.js');
  assert.ok(res === null || res === '/srv/app/dist/a/b.js', String(res));
});
test('double slashes never escape root', () => {
  assertInsideOrNull(r('//a.js'));
  assertInsideOrNull(r('/a//b.js'));
  assertInsideOrNull(r('///'));
});
test('protocol-like double slash prefix never escapes root', () => {
  assertInsideOrNull(r('//etc/passwd'));
});
test('absolute-looking encoded path never escapes root', () => {
  assertInsideOrNull(r('/%2fetc/passwd'));
});

// ---- backslash / NUL / invalid encoding ----
test('raw backslash is refused', () => {
  assert.equal(r('/a\\b.js'), null);
});
test('backslash traversal is refused', () => {
  assert.equal(r('/..\\package.json'), null);
});
test('encoded backslash %5c is refused', () => {
  assert.equal(r('/a%5cb.js'), null);
});
test('encoded backslash %5C uppercase is refused', () => {
  assert.equal(r('/a%5Cb.js'), null);
});
test('encoded backslash traversal is refused', () => {
  assert.equal(r('/%2e%2e%5cpackage.json'), null);
});
test('raw NUL byte is refused', () => {
  assert.equal(r('/a\0b.js'), null);
});
test('encoded NUL %00 is refused', () => {
  assert.equal(r('/a%00b.js'), null);
});
test('NUL used to truncate an extension is refused', () => {
  assert.equal(r('/index.html%00.png'), null);
});
test('NUL in the query part does not crash', () => {
  const res = r('/app.js?x=%00');
  assert.ok(res === null || res === '/srv/app/dist/app.js');
});
test('truncated multibyte sequence %E0%A4%A is refused', () => {
  assert.equal(r('/%E0%A4%A'), null);
});
test('lone percent is refused', () => {
  assert.equal(r('/%'), null);
});
test('trailing percent is refused', () => {
  assert.equal(r('/a%'), null);
});
test('non-hex escape %zz is refused', () => {
  assert.equal(r('/%zz'), null);
});
test('invalid UTF-8 lone continuation byte %80 is refused', () => {
  assert.equal(r('/%80.js'), null);
});

// ---- dotfiles ----
test('.env is refused', () => {
  assert.equal(r('/.env'), null);
});
test('.git/config is refused', () => {
  assert.equal(r('/.git/config'), null);
});
test('dotfile in nested segment is refused', () => {
  assert.equal(r('/a/b/.git/config'), null);
});
test('dotfile as last segment is refused', () => {
  assert.equal(r('/a/.hidden'), null);
});
test('dotfile directory in the middle is refused', () => {
  assert.equal(r('/a/.hidden/b.js'), null);
});
test('encoded dot dotfile %2eenv is refused', () => {
  assert.equal(r('/%2eenv'), null);
});
test('.well-known is refused (any segment starting with dot)', () => {
  assert.equal(r('/.well-known/x'), null);
});
test('triple-dot segment is refused', () => {
  assert.equal(r('/.../x'), null);
});
test('dot inside a name (not leading) is allowed', () => {
  assert.equal(r('/a.b.c.js'), '/srv/app/dist/a.b.c.js');
});
test('directory ending in dot-like name not at start is allowed', () => {
  assert.equal(r('/v1.2/app.js'), '/srv/app/dist/v1.2/app.js');
});

// ---- non-string ----
for (const [label, v] of [
  ['undefined', undefined], ['null', null], ['number', 42], ['NaN', NaN],
  ['boolean', true], ['object', {}], ['array', ['/a.js']], ['empty array', []],
  ['function', () => '/a.js'], ['String object', new String('/a.js')],
]) {
  test(`non-string urlPath (${label}) returns null`, () => {
    assert.equal(r(v), null);
  });
}

// ---- root variants / size ----
test('root with trailing slash resolves file correctly', () => {
  assert.equal(r('/a.js', '/srv/app/dist/'), '/srv/app/dist/a.js');
});
test('root with trailing slash resolves / to index.html', () => {
  assert.equal(r('/', '/srv/app/dist/'), '/srv/app/dist/index.html');
});
test('root with trailing slash still refuses traversal', () => {
  assert.equal(r('/../x', '/srv/app/dist/'), null);
});
test('sibling directory sharing root prefix is not reachable', () => {
  assertInsideOrNull(r('/../dist-evil/x.js'));
  assert.equal(r('/../dist-evil/x.js'), null);
});
test('very long segment does not throw and stays inside root', () => {
  assertInsideOrNull(r('/' + 'a'.repeat(100000)));
});
test('very long path with many segments stays inside root', () => {
  assertInsideOrNull(r('/a'.repeat(20000) + '.js'));
});
test('many .. segments are refused', () => {
  assert.equal(r('/..'.repeat(5000) + '/x'), null);
});
test('result is always a string or null', () => {
  for (const u of ['/', '/x', '/.x', '/%', '/../x']) {
    const v = r(u);
    assert.ok(v === null || typeof v === 'string');
  }
});
test('function is pure: repeated calls give identical results', () => {
  assert.equal(r('/a.js'), r('/a.js'));
  assert.equal(r('/../a.js'), r('/../a.js'));
});
test('root is not mutated in effect: different roots give different prefixes', () => {
  assert.equal(r('/a.js', '/var/www'), '/var/www/a.js');
  assert.equal(r('/a.js', '/srv/app/dist'), '/srv/app/dist/a.js');
});

// ---- property style ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FRAGMENTS = [
  '..', '.', 'a', 'b.js', 'index.html', '%2e%2e', '%2E%2E', '%252e%252e', '%5c', '%5C',
  '%00', '', 'x y', '%20', '%41', '...', '.env', '.git', 'é', '%C3%A9', '%2f', '%252f',
  '\\', '?q=..', '#..', '%E0%A4%A', '%', 'assets', 'app.js',
];

test('property: 5000 seeded random paths are null or strictly inside root with no .. segment', () => {
  const rnd = mulberry32(12345);
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(rnd() * 6);
    let p = '';
    for (let j = 0; j < n; j++) p += '/' + FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)];
    const res = r(p);
    try {
      assertInsideOrNull(res);
    } catch (e) {
      e.message = `input ${JSON.stringify(p)} -> ${JSON.stringify(res)}: ${e.message}`;
      throw e;
    }
  }
});

test('property: random paths with root trailing slash are null or strictly inside root', () => {
  const rnd = mulberry32(987654321);
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rnd() * 5);
    let p = '';
    for (let j = 0; j < n; j++) p += '/' + FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)];
    const res = r(p, '/srv/app/dist/');
    try {
      assertInsideOrNull(res, '/srv/app/dist');
    } catch (e) {
      e.message = `input ${JSON.stringify(p)} -> ${JSON.stringify(res)}: ${e.message}`;
      throw e;
    }
  }
});

test('property: any path containing a dotfile-leading segment is refused', () => {
  const rnd = mulberry32(424242);
  const safe = ['a', 'b.js', 'assets', 'x y', 'café'];
  const dots = ['.env', '.git', '.hidden', '.a.b', '...x'];
  for (let i = 0; i < 500; i++) {
    const before = Array.from({ length: Math.floor(rnd() * 3) }, () => safe[Math.floor(rnd() * safe.length)]);
    const after = Array.from({ length: Math.floor(rnd() * 3) }, () => safe[Math.floor(rnd() * safe.length)]);
    const segs = [...before, dots[Math.floor(rnd() * dots.length)], ...after];
    const p = '/' + segs.join('/');
    assert.equal(r(p), null, p);
  }
});

test('property: clean random paths map to root + path exactly', () => {
  const rnd = mulberry32(2024);
  const safe = ['a', 'b.js', 'assets', 'v1.2', 'app-1a2b.css', 'café'];
  for (let i = 0; i < 500; i++) {
    const segs = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => safe[Math.floor(rnd() * safe.length)]);
    assert.equal(r('/' + segs.join('/')), '/srv/app/dist/' + segs.join('/'));
  }
});
