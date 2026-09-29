import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeName, isAllowedOrigin } from '../../src/server/security.js';

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

const ALLOWED_CHARS = /^[\p{L}\p{N} _-]*$/u;
const cpLen = (s) => [...s].length;

// ---------- sanitizeName ----------
test('sanitizeName keeps a plain ASCII name unchanged', () => {
  assert.equal(sanitizeName('Bob'), 'Bob');
});

test('sanitizeName keeps digits, underscore, hyphen and single spaces', () => {
  assert.equal(sanitizeName('Player_1-x 2'), 'Player_1-x 2');
});

test('sanitizeName keeps Unicode letters (Hebrew)', () => {
  assert.equal(sanitizeName('שלום'), 'שלום');
});

test('sanitizeName keeps Unicode letters (accented Latin, Cyrillic)', () => {
  assert.equal(sanitizeName('Zoë Иван'), 'Zoë Иван');
});

test('sanitizeName keeps non-ASCII digits (Arabic-Indic)', () => {
  assert.equal(sanitizeName('٣٤'), '٣٤');
});

for (const nonString of [undefined, null, 0, 42, true, {}, [], ['a'], () => 'x', Symbol('s'), 10n]) {
  test(`sanitizeName(${typeof nonString === 'symbol' ? 'Symbol' : String(nonString)}) of type ${typeof nonString} returns ''`, () => {
    assert.equal(sanitizeName(nonString), '');
  });
}

test('sanitizeName never leaves < or > from a script tag', () => {
  const r = sanitizeName('<script>alert(1)</script>');
  assert.ok(!r.includes('<') && !r.includes('>'), r);
  assert.match(r, ALLOWED_CHARS);
});

test('sanitizeName strips an img onerror payload down to the allowed alphabet', () => {
  const r = sanitizeName('<img src=x onerror="alert(document.cookie)">');
  assert.match(r, ALLOWED_CHARS);
  assert.ok(!/[<>"'=()]/.test(r), r);
});

test('sanitizeName of only markup punctuation is empty', () => {
  assert.equal(sanitizeName('<>'), '');
  assert.equal(sanitizeName('"\';&/\\'), '');
});

test('sanitizeName of whitespace only is empty', () => {
  assert.equal(sanitizeName('     '), '');
});

test('sanitizeName trims leading and trailing spaces', () => {
  assert.equal(sanitizeName('   bob   '), 'bob');
});

test('sanitizeName collapses runs of spaces into one', () => {
  assert.equal(sanitizeName('a     b'), 'a b');
  assert.equal(sanitizeName('  a   b   c  '), 'a b c');
});

test('sanitizeName truncates to 16 code points', () => {
  assert.equal(cpLen(sanitizeName('a'.repeat(200))), 16);
  assert.equal(sanitizeName('abcdefghijklmnopqrstuvwxyz'), 'abcdefghijklmnop');
});

test('sanitizeName keeps a name of exactly 16 characters intact', () => {
  assert.equal(sanitizeName('a'.repeat(16)), 'a'.repeat(16));
});

test('sanitizeName counts code points, not UTF-16 units (astral letters)', () => {
  const r = sanitizeName('\u{1D49C}'.repeat(30)); // MATHEMATICAL SCRIPT CAPITAL A, a letter
  assert.equal(cpLen(r), 16);
  assert.match(r, ALLOWED_CHARS);
});

test('sanitizeName never yields a lone surrogate when cutting astral input', () => {
  const r = sanitizeName('a'.repeat(15) + '\u{1D49C}\u{1D49C}');
  assert.ok(r.isWellFormed(), 'must be well-formed UTF-16');
});

test('sanitizeName removes lone surrogates', () => {
  const r = sanitizeName('a' + String.fromCharCode(0xd800) + 'b');
  assert.ok(r.isWellFormed());
  assert.match(r, ALLOWED_CHARS);
});

test('sanitizeName never returns control characters or newlines', () => {
  const r = sanitizeName('a\nb\rc\td\u0000e\u001bf\u007fg');
  assert.match(r, ALLOWED_CHARS);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(r));
});

test('sanitizeName strips emoji', () => {
  const r = sanitizeName('bob\u{1F600}');
  assert.equal(r, 'bob');
});

test('sanitizeName of "__proto__" is just a harmless string', () => {
  assert.equal(sanitizeName('__proto__'), '__proto__');
});

test('sanitizeName result has no leading/trailing space even when truncation ends on a space', () => {
  const r = sanitizeName('a'.repeat(15) + ' bbbb');
  assert.equal(r, r.trim());
  assert.ok(cpLen(r) <= 16);
});

test('sanitizeName is idempotent', () => {
  for (const s of ['  a  b  ', '<b>x</b>', 'שלום  עולם', 'x'.repeat(40)]) {
    const once = sanitizeName(s);
    assert.equal(sanitizeName(once), once);
  }
});

test('property: sanitizeName output obeys every invariant for random junk', () => {
  const rnd = mulberry32(31337);
  for (let i = 0; i < 1500; i++) {
    const len = Math.floor(rnd() * 60);
    let s = '';
    for (let j = 0; j < len; j++) {
      const roll = rnd();
      if (roll < 0.25) s += ' ';
      else if (roll < 0.5) s += String.fromCharCode(32 + Math.floor(rnd() * 95));
      else if (roll < 0.7) s += String.fromCharCode(Math.floor(rnd() * 0x3000));
      else if (roll < 0.85) s += String.fromCodePoint(0x10000 + Math.floor(rnd() * 0x2000));
      else s += '<>"\'&\n\t\u0000​‮';
    }
    const r = sanitizeName(s);
    assert.equal(typeof r, 'string');
    assert.ok(r.isWellFormed(), `not well formed for input #${i}`);
    assert.match(r, ALLOWED_CHARS, `charset for input #${i}`);
    assert.ok(cpLen(r) <= 16, `length for input #${i}`);
    assert.equal(r, r.trim(), `trim for input #${i}`);
    assert.ok(!r.includes('  '), `double space for input #${i}`);
  }
});

// ---------- isAllowedOrigin ----------
test('same-origin: origin host equals Host header -> true', () => {
  assert.equal(isAllowedOrigin('http://localhost:3000', 'localhost:3000', []), true);
});

test('same-origin comparison is case-insensitive on both sides', () => {
  assert.equal(isAllowedOrigin('http://LOCALHOST:3000', 'localhost:3000', []), true);
  assert.equal(isAllowedOrigin('http://localhost:3000', 'LocalHost:3000', []), true);
});

test('same-origin mode does not compare the scheme', () => {
  assert.equal(isAllowedOrigin('https://game.example.com', 'game.example.com', []), true);
});

test('same-origin includes the port: different port -> false', () => {
  assert.equal(isAllowedOrigin('http://localhost:3001', 'localhost:3000', []), false);
});

test('same-origin: origin without port vs Host with port -> false', () => {
  assert.equal(isAllowedOrigin('http://localhost', 'localhost:3000', []), false);
});

test('same-origin: different host -> false', () => {
  assert.equal(isAllowedOrigin('http://evil.com', 'localhost:3000', []), false);
});

test('same-origin: suffix attack (host.evil.com) -> false', () => {
  assert.equal(isAllowedOrigin('http://localhost:3000.evil.com', 'localhost:3000', []), false);
  assert.equal(isAllowedOrigin('http://game.example.com.evil.com', 'game.example.com', []), false);
});

test('same-origin: prefix attack (evil-game.example.com) -> false', () => {
  assert.equal(isAllowedOrigin('http://evil-game.example.com', 'game.example.com', []), false);
});

test('same-origin: userinfo trick (host@evil.com) -> false', () => {
  assert.equal(isAllowedOrigin('http://localhost:3000@evil.com', 'localhost:3000', []), false);
});

test('same-origin: missing Host header -> false', () => {
  assert.equal(isAllowedOrigin('http://localhost:3000', undefined, []), false);
  assert.equal(isAllowedOrigin('http://localhost:3000', '', []), false);
});

for (const bad of [undefined, null, '', 0, 42, true, {}, [], ['http://localhost:3000']]) {
  test(`origin header ${JSON.stringify(bad) ?? String(bad)} (${typeof bad}) -> false`, () => {
    assert.equal(isAllowedOrigin(bad, 'localhost:3000', []), false);
  });
}

test('origin "null" string -> false even in same-origin mode', () => {
  assert.equal(isAllowedOrigin('null', 'null', []), false);
  assert.equal(isAllowedOrigin('null', 'localhost:3000', []), false);
});

test('origin "null" string -> false even if listed in allowedOrigins', () => {
  assert.equal(isAllowedOrigin('null', 'localhost:3000', ['null']), false);
});

test('unparseable origin -> false', () => {
  assert.equal(isAllowedOrigin('not a url', 'localhost:3000', []), false);
  assert.equal(isAllowedOrigin('://', 'localhost:3000', []), false);
  assert.equal(isAllowedOrigin('http://', 'localhost:3000', []), false);
});

test('allowlist: exact match -> true', () => {
  assert.equal(isAllowedOrigin('https://game.example.com', 'anything', ['https://game.example.com']), true);
});

test('allowlist: match is case-insensitive through lowercasing of the origin', () => {
  assert.equal(isAllowedOrigin('HTTPS://GAME.EXAMPLE.COM', 'x', ['https://game.example.com']), true);
});

test('allowlist: any entry in a multi-entry list may match', () => {
  const list = ['https://a.example.com', 'https://b.example.com'];
  assert.equal(isAllowedOrigin('https://b.example.com', 'x', list), true);
});

test('allowlist non-empty: same-origin request that is not listed -> false', () => {
  assert.equal(isAllowedOrigin('http://localhost:3000', 'localhost:3000', ['https://game.example.com']), false);
});

test('allowlist: prefix of a listed origin is not enough', () => {
  assert.equal(isAllowedOrigin('https://game.example.com.evil.com', 'x', ['https://game.example.com']), false);
});

test('allowlist: listed origin as a prefix of the candidate with a path is not enough', () => {
  assert.equal(isAllowedOrigin('https://game.example.com/evil', 'x', ['https://game.example.com']), false);
});

test('allowlist: different scheme -> false', () => {
  assert.equal(isAllowedOrigin('http://game.example.com', 'x', ['https://game.example.com']), false);
});

test('allowlist: different port -> false', () => {
  assert.equal(isAllowedOrigin('https://game.example.com:8443', 'x', ['https://game.example.com']), false);
});

test('allowlist: non-string origin -> false', () => {
  assert.equal(isAllowedOrigin(undefined, 'x', ['https://game.example.com']), false);
  assert.equal(isAllowedOrigin(null, 'x', ['https://game.example.com']), false);
});

test('property: isAllowedOrigin never throws and always returns a boolean for junk input', () => {
  const rnd = mulberry32(7);
  const junk = [undefined, null, '', ' ', 'null', 'http://', '::', 'http://[', 'ftp://x', 'javascript:alert(1)', 0, NaN, {}, [], () => 1, Symbol('x')];
  for (let i = 0; i < 400; i++) {
    let s = '';
    const len = Math.floor(rnd() * 30);
    for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(rnd() * 0x300));
    junk.push(s, 'http://' + s);
  }
  for (const o of junk) {
    for (const h of [undefined, '', 'localhost:3000', 'x'.repeat(5)]) {
      for (const list of [[], ['https://a.com']]) {
        const r = isAllowedOrigin(o, h, list);
        assert.equal(typeof r, 'boolean');
      }
    }
  }
});
