// Crosshair share code encoder and decoder (SPEC 40.4).
// Compact text serialization for the seven crosshair preference fields in prefs.js.

export const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const CROSSHAIR_STYLES = Object.freeze([
  'cross', 'dot', 'circle', 'tee', 'cross-dot',
]);

export const CROSSHAIR_COLORS_KEYS = Object.freeze([
  'green', 'cyan', 'white', 'yellow', 'magenta', 'red',
]);

export const DEFAULT_CROSSHAIR_PREFS = Object.freeze({
  crosshairStyle: 'cross',
  crosshairColor: 'green',
  crosshairSize: 14,
  crosshairGap: 4,
  crosshairThickness: 2,
  crosshairOutline: true,
  crosshairDynamic: true,
});

export function encode(prefsSubset = {}) {
  const style = CROSSHAIR_STYLES.includes(prefsSubset.crosshairStyle) ? prefsSubset.crosshairStyle : DEFAULT_CROSSHAIR_PREFS.crosshairStyle;
  const color = CROSSHAIR_COLORS_KEYS.includes(prefsSubset.crosshairColor) ? prefsSubset.crosshairColor : DEFAULT_CROSSHAIR_PREFS.crosshairColor;
  const sizeNum = prefsSubset.crosshairSize !== undefined ? Number(prefsSubset.crosshairSize) : DEFAULT_CROSSHAIR_PREFS.crosshairSize;
  const size = Math.min(30, Math.max(4, Number.isFinite(sizeNum) ? Math.round(sizeNum) : DEFAULT_CROSSHAIR_PREFS.crosshairSize));
  const gapNum = prefsSubset.crosshairGap !== undefined ? Number(prefsSubset.crosshairGap) : DEFAULT_CROSSHAIR_PREFS.crosshairGap;
  const gap = Math.min(12, Math.max(0, Number.isFinite(gapNum) ? Math.round(gapNum) : DEFAULT_CROSSHAIR_PREFS.crosshairGap));
  const thickNum = prefsSubset.crosshairThickness !== undefined ? Number(prefsSubset.crosshairThickness) : DEFAULT_CROSSHAIR_PREFS.crosshairThickness;
  const thickness = Math.min(5, Math.max(1, Number.isFinite(thickNum) ? Math.round(thickNum) : DEFAULT_CROSSHAIR_PREFS.crosshairThickness));
  const outline = Boolean(prefsSubset.crosshairOutline ?? DEFAULT_CROSSHAIR_PREFS.crosshairOutline);
  const dynamic = Boolean(prefsSubset.crosshairDynamic ?? DEFAULT_CROSSHAIR_PREFS.crosshairDynamic);

  const styleIdx = CROSSHAIR_STYLES.indexOf(style);
  const colorIdx = CROSSHAIR_COLORS_KEYS.indexOf(color);
  const sizeVal = size - 4; // 0..26
  const gapVal = gap; // 0..12
  const thickVal = thickness - 1; // 0..4
  const version = 1;

  let bits = 0n;
  bits = (bits << 4n) | BigInt(version & 0xF);
  bits = (bits << 3n) | BigInt(styleIdx & 0x7);
  bits = (bits << 3n) | BigInt(colorIdx & 0x7);
  bits = (bits << 5n) | BigInt(sizeVal & 0x1F);
  bits = (bits << 4n) | BigInt(gapVal & 0xF);
  bits = (bits << 3n) | BigInt(thickVal & 0x7);
  bits = (bits << 1n) | BigInt(outline ? 1 : 0);
  bits = (bits << 1n) | BigInt(dynamic ? 1 : 0);
  bits = bits << 11n; // reserved padding

  const payload = [];
  for (let i = 6; i >= 0; i--) {
    payload.push(Number((bits >> BigInt(i * 5)) & 0x1Fn));
  }

  let checkVal = 0;
  for (let i = 0; i < 7; i++) {
    checkVal = (checkVal * 3 + payload[i] + (i + 1) * 7) % 32;
  }

  const indices = [...payload, checkVal];
  const str = indices.map((idx) => ALPHABET[idx]).join('');
  return `BCA-${str.slice(0, 4)}-${str.slice(4, 8)}`;
}

export function decode(code) {
  if (typeof code !== 'string') return { ok: false, reason: 'Bad length' };
  const clean = code.trim().toUpperCase().replace(/[\s\-]/g, '');
  if (!clean.startsWith('BCA')) return { ok: false, reason: 'Bad prefix' };
  const body = clean.slice(3);
  if (body.length !== 8) return { ok: false, reason: 'Bad length' };

  const indices = [];
  for (let i = 0; i < 8; i++) {
    const idx = ALPHABET.indexOf(body[i]);
    if (idx === -1) return { ok: false, reason: 'Bad check' };
    indices.push(idx);
  }

  let computedCheck = 0;
  for (let i = 0; i < 7; i++) {
    computedCheck = (computedCheck * 3 + indices[i] + (i + 1) * 7) % 32;
  }
  if (indices[7] !== computedCheck) return { ok: false, reason: 'Bad check' };

  let bits = 0n;
  for (let i = 0; i < 7; i++) {
    bits = (bits << 5n) | BigInt(indices[i]);
  }

  bits = bits >> 11n; // discard reserved bits
  const dynamic = Number(bits & 1n) === 1;
  bits = bits >> 1n;
  const outline = Number(bits & 1n) === 1;
  bits = bits >> 1n;
  const thickVal = Number(bits & 0x7n);
  bits = bits >> 3n;
  const gapVal = Number(bits & 0xFn);
  bits = bits >> 4n;
  const sizeVal = Number(bits & 0x1Fn);
  bits = bits >> 5n;
  const colorIdx = Number(bits & 0x7n);
  bits = bits >> 3n;
  const styleIdx = Number(bits & 0x7n);
  bits = bits >> 3n;
  const version = Number(bits & 0xFn);

  if (version !== 1) return { ok: false, reason: 'Bad version' };

  if (styleIdx >= CROSSHAIR_STYLES.length || colorIdx >= CROSSHAIR_COLORS_KEYS.length) {
    return { ok: false, reason: 'Out of range' };
  }

  const size = sizeVal + 4;
  const gap = gapVal;
  const thickness = thickVal + 1;

  if (size < 4 || size > 30 || gap < 0 || gap > 12 || thickness < 1 || thickness > 5) {
    return { ok: false, reason: 'Out of range' };
  }

  return {
    ok: true,
    values: {
      crosshairStyle: CROSSHAIR_STYLES[styleIdx],
      crosshairColor: CROSSHAIR_COLORS_KEYS[colorIdx],
      crosshairSize: size,
      crosshairGap: gap,
      crosshairThickness: thickness,
      crosshairOutline: outline,
      crosshairDynamic: dynamic,
    },
  };
}

export const DEFAULT_CODE = encode(DEFAULT_CROSSHAIR_PREFS);

export const PRESETS = Object.freeze([
  {
    name: 'Classic',
    code: encode({ crosshairStyle: 'cross', crosshairColor: 'green', crosshairSize: 14, crosshairGap: 4, crosshairThickness: 2, crosshairOutline: true, crosshairDynamic: true }),
  },
  {
    name: 'Dot',
    code: encode({ crosshairStyle: 'dot', crosshairColor: 'cyan', crosshairSize: 8, crosshairGap: 0, crosshairThickness: 2, crosshairOutline: true, crosshairDynamic: false }),
  },
  {
    name: 'Precision',
    code: encode({ crosshairStyle: 'cross-dot', crosshairColor: 'yellow', crosshairSize: 10, crosshairGap: 2, crosshairThickness: 1, crosshairOutline: true, crosshairDynamic: false }),
  },
  {
    name: 'Dynamic T',
    code: encode({ crosshairStyle: 'tee', crosshairColor: 'white', crosshairSize: 16, crosshairGap: 5, crosshairThickness: 2, crosshairOutline: true, crosshairDynamic: true }),
  },
]);
