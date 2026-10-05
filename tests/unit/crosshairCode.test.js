// SPEC 40.4: crosshair share codes roundtrip, reject typos and stay append only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, PRESETS, DEFAULT_CODE, DEFAULT_CROSSHAIR_PREFS, CROSSHAIR_STYLES, CROSSHAIR_COLOR_KEYS, CROSSHAIR_FIELDS, ALPHABET, crosshairSubset, looksLikeCode } from '../../src/shared/crosshairCode.js';
import { PREFS_SCHEMA, CROSSHAIR_COLORS, defaults } from '../../src/client/prefs.js';

const FORMAT = /^BCA-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;

test('a code has the BCA-XXXX-XXXX shape in an alphabet without 0, O, 1 and I', () => {
  assert.match(DEFAULT_CODE, FORMAT);
  assert.equal(ALPHABET.length, 32);
  for (const ch of '01OI') assert.equal(ALPHABET.includes(ch), false);
});

test('every field roundtrips over its full range', () => {
  for (const crosshairStyle of CROSSHAIR_STYLES) for (const crosshairColor of CROSSHAIR_COLOR_KEYS) {
    const r = decode(encode({ ...DEFAULT_CROSSHAIR_PREFS, crosshairStyle, crosshairColor }));
    assert.equal(r.ok, true);
    assert.equal(r.values.crosshairStyle, crosshairStyle);
    assert.equal(r.values.crosshairColor, crosshairColor);
  }
  for (let crosshairSize = 4; crosshairSize <= 30; crosshairSize++) assert.equal(decode(encode({ ...DEFAULT_CROSSHAIR_PREFS, crosshairSize })).values.crosshairSize, crosshairSize);
  for (let crosshairGap = 0; crosshairGap <= 12; crosshairGap++) assert.equal(decode(encode({ ...DEFAULT_CROSSHAIR_PREFS, crosshairGap })).values.crosshairGap, crosshairGap);
  for (let crosshairThickness = 1; crosshairThickness <= 5; crosshairThickness++) assert.equal(decode(encode({ ...DEFAULT_CROSSHAIR_PREFS, crosshairThickness })).values.crosshairThickness, crosshairThickness);
  for (const crosshairOutline of [true, false]) for (const crosshairDynamic of [true, false]) {
    const v = decode(encode({ ...DEFAULT_CROSSHAIR_PREFS, crosshairOutline, crosshairDynamic })).values;
    assert.equal(v.crosshairOutline, crosshairOutline);
    assert.equal(v.crosshairDynamic, crosshairDynamic);
  }
});

test('encode clamps out of range numbers and falls back on unknown enums', () => {
  const v = decode(encode({ crosshairStyle: 'nope', crosshairColor: 'pink', crosshairSize: 99, crosshairGap: -3, crosshairThickness: 'x' })).values;
  assert.deepEqual(v, { ...DEFAULT_CROSSHAIR_PREFS, crosshairSize: 30, crosshairGap: 0 });
});

test('every preset decodes and the default code matches the prefs defaults', () => {
  assert.equal(PRESETS.length, 4);
  const names = new Set();
  for (const p of PRESETS) {
    assert.match(p.code, FORMAT);
    assert.equal(decode(p.code).ok, true, p.name);
    names.add(p.name);
  }
  assert.equal(names.size, 4);
  assert.deepEqual(decode(DEFAULT_CODE).values, crosshairSubset(defaults()));
});

test('input is tolerant of case, spaces and missing dashes', () => {
  const code = PRESETS[1].code;
  assert.deepEqual(decode(`  ${code.toLowerCase()}  `), decode(code));
  assert.deepEqual(decode(code.replace(/-/g, '')), decode(code));
  assert.deepEqual(decode(code.replace(/-/g, ' ')), decode(code));
});

test('the check character catches every single character typo and sampled transpositions', () => {
  const code = encode({ ...DEFAULT_CROSSHAIR_PREFS, crosshairStyle: 'tee', crosshairSize: 9, crosshairGap: 7 });
  const body = code.slice(4).replace('-', '');
  for (let i = 0; i < body.length; i++) {
    for (const ch of ALPHABET) {
      if (ch === body[i]) continue;
      const typo = body.slice(0, i) + ch + body.slice(i + 1);
      assert.equal(decode(`BCA-${typo}`).ok, false, `typo at ${i}: ${typo}`);
    }
  }
  let caught = 0;
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] === body[i + 1]) { caught++; continue; }
    const swapped = body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2);
    if (!decode(`BCA-${swapped}`).ok) caught++;
  }
  assert.ok(caught >= body.length - 2, `transpositions caught: ${caught}`);
});

test('bad prefix, length, character and version are named', () => {
  assert.equal(decode('XYZ-42CA-G22G').reason, 'Bad prefix');
  assert.equal(decode(42).reason, 'Bad prefix');
  assert.equal(decode('BCA-42CA-G22').reason, 'Bad length');
  assert.equal(decode('BCA-42CA-G22GG').reason, 'Bad length');
  assert.equal(decode('BCA-02CA-G22G').reason, 'Bad character');
  // version nibble lives in the top bits of the first character: force 0 there and fix the check by brute force
  const body = DEFAULT_CODE.slice(4).replace('-', '');
  let found = null;
  for (const ch of ALPHABET) {
    const cand = body.slice(0, 7).replace(/^./, ALPHABET[0]) + ch; // first char = 0 bits -> version 0
    const r = decode(`BCA-${cand}`);
    if (r.reason !== 'Bad check') { found = r; break; }
  }
  assert.ok(found && found.reason === 'Bad version', JSON.stringify(found));
});

test('an unknown enum index is out of range, so new styles can be appended later without breaking old codes', () => {
  // style index 7 does not exist (5 styles): build the payload by hand
  const bits = (1n << 31n) | (7n << 28n) | (0n << 25n) | (10n << 20n) | (4n << 16n) | (1n << 13n) | (1n << 12n) | (1n << 11n);
  const payload = [];
  for (let i = 6; i >= 0; i--) payload.push(Number((bits >> BigInt(i * 5)) & 0x1Fn));
  let check = 0;
  for (let i = 0; i < 7; i++) check = (check * 3 + payload[i] + (i + 1) * 7) % 32;
  const code = `BCA-${[...payload, check].map((i) => ALPHABET[i]).join('')}`;
  assert.equal(decode(code).reason, 'Out of range');
});

test('prefs.js and the codec share one enum order and one field list', () => {
  assert.deepEqual([...PREFS_SCHEMA.crosshairStyle.values], [...CROSSHAIR_STYLES]);
  assert.deepEqual([...PREFS_SCHEMA.crosshairColor.values], [...CROSSHAIR_COLOR_KEYS]);
  assert.deepEqual(Object.keys(CROSSHAIR_COLORS), [...CROSSHAIR_COLOR_KEYS]);
  for (const k of CROSSHAIR_FIELDS) assert.equal(PREFS_SCHEMA[k].tab, 'hud', k);
  assert.equal(looksLikeCode(' bca-42ca-g22g'), true);
  assert.equal(looksLikeCode('hello'), false);
});
