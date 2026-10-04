// Numbers and pure helpers behind the arena visual pass (docs/SPEC.md section 19.3).
// No Three.js here: scene.js and remote.js turn these into lights, materials and sprites, and
// tests/unit/arenaStyle.test.js checks the decisions without a GPU.
import { PALETTE } from './theme.js';

/** Dusk sky: a deep navy zenith over a slate horizon. The fog takes the horizon color. */
export const SKY = Object.freeze({ zenith: 0x070a16, horizon: 0x0f172a, radius: 240 });
export const FOG = Object.freeze({ color: SKY.horizon, near: 35, far: 140 });
export const SUN = Object.freeze({
  color: 0xffe3c2, intensity: 1.9, position: [28, 46, 18],
  shadowExtent: 46, shadowNear: 1, shadowFar: 140, shadowBias: -0.0006, shadowNormalBias: 0.02,
});
export const HEMI = Object.freeze({ sky: 0x9db1dc, ground: 0x2a3140, intensity: 1.0 });
/** Cool fill from the far side so faces turned away from the sun still read; no shadows. */
export const FILL = Object.freeze({ color: 0x8fa6ff, intensity: 0.7, position: [-24, 20, -30] });
export const FLOOR = Object.freeze({ color: 0x343e4b, roughness: 0.92, metalness: 0.02 });
export const GRID = Object.freeze({ center: 0x5a6b80, line: 0x3b4858, opacity: 0.22 });
export const NAME_TAG = Object.freeze({ height: 48, font: '700 28px system-ui, sans-serif', padX: 18, worldHeight: 0.36, y: 2.05 });

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toRgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** Sky color for a normalized height (0 horizon, 1 zenith) as [r, g, b] in 0..1. */
export function skyColorAt(h) {
  const k = clamp01(h);
  const a = toRgb(SKY.horizon);
  const b = toRgb(SKY.zenith);
  // Ease toward the zenith so the horizon band stays wide, like a real dusk.
  const e = k * k * (3 - 2 * k);
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
}

/** Material parameters for box i: slate hue, per-box lightness and finish so the cover reads as separate blocks. */
export function boxMaterialParams(i) {
  return {
    color: { h: 0.58, s: 0.14, l: 0.38 + (i % 4) * 0.05 },
    roughness: 0.55 + (i % 3) * 0.15,
    metalness: 0.04 + (i % 2) * 0.1,
  };
}

/** Team by player id parity until Phase 2 TDM assigns real teams: even blue, odd red (theme palette). */
export function teamColorHex(id, team = -1) {
  // SPEC 22: in TDM the server's team (0 Blue, 1 Red) decides; in DM the id parity keeps the two-tone look.
  if (team === 0) return PALETTE.teamBlue;
  if (team === 1) return PALETTE.teamRed;
  return id % 2 === 0 ? PALETTE.teamBlue : PALETTE.teamRed;
}

/** Canvas and sprite dimensions for a name tag; width follows the text so short names get a short pill. */
export function nameTagLayout(name) {
  const text = (typeof name === 'string' && name.length ? [...name].slice(0, 16).join('') : '?');
  // 15 px per glyph at 28 px bold is a safe upper bound for the fonts we accept; the canvas measures exactly.
  const approx = text.length * 15 + NAME_TAG.padX * 2;
  const width = Math.ceil(approx / 2) * 2;
  const height = NAME_TAG.height;
  return { text, width, height, scale: [NAME_TAG.worldHeight * (width / height), NAME_TAG.worldHeight, 1] };
}

/** Shadow map resolution: phones (short landscape) get the cheaper map. */
export function shadowMapSizeFor(width, height) {
  return height <= 500 || width < 1000 ? 1024 : 2048;
}
