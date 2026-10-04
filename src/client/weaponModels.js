// Weapon models shared by the first person view (weaponView.js) and the hands of remote players (remote.js), SPEC 31.1.
// Pure table: parts are [w, h, d, x, y, z, material] in weapon space (muzzle toward -Z, grip at the origin),
// materials are 'body' (dark receiver), 'accent' (per weapon tint), 'wood' (furniture) and 'glass' (optics).
export const WEAPON_MODELS = Object.freeze({
  rifle: {
    accent: 0x4c6a92, muzzle: -0.62, parts: [
      [0.08, 0.1, 0.56, 0, 0.02, -0.14, 'body'], // receiver
      [0.035, 0.035, 0.42, 0, 0.05, -0.52, 'body'], // barrel
      [0.05, 0.08, 0.26, 0, -0.02, -0.4, 'accent'], // handguard
      [0.06, 0.16, 0.08, 0.0, -0.12, 0.02, 'body'], // grip
      [0.05, 0.2, 0.07, 0, -0.14, -0.14, 'accent'], // magazine
      [0.07, 0.09, 0.26, 0, 0.0, 0.26, 'body'], // stock
      [0.03, 0.05, 0.14, 0, 0.1, -0.1, 'body'], // rail sight
    ],
  },
  smg: {
    accent: 0x7aa2ff, muzzle: -0.42, parts: [
      [0.08, 0.1, 0.4, 0, 0.02, -0.08, 'body'],
      [0.03, 0.03, 0.2, 0, 0.04, -0.38, 'body'],
      [0.05, 0.16, 0.08, 0, -0.12, 0.04, 'body'],
      [0.045, 0.24, 0.06, 0, -0.15, -0.12, 'accent'],
      [0.02, 0.06, 0.2, 0, 0.0, 0.2, 'body'], // folding stock
      [0.03, 0.04, 0.1, 0, 0.09, -0.06, 'accent'],
    ],
  },
  shotgun: {
    accent: 0xff8a3d, muzzle: -0.8, parts: [
      [0.08, 0.1, 0.5, 0, 0.0, -0.1, 'body'],
      [0.045, 0.045, 0.6, 0, 0.03, -0.5, 'body'],
      [0.045, 0.045, 0.5, 0, -0.03, -0.5, 'body'], // tube magazine
      [0.06, 0.09, 0.22, 0, -0.03, -0.42, 'wood'], // pump
      [0.07, 0.14, 0.1, 0, -0.1, 0.02, 'wood'],
      [0.07, 0.1, 0.3, 0, -0.01, 0.3, 'wood'],
    ],
  },
  sniper: {
    accent: 0xe06cff, muzzle: -0.98, parts: [
      [0.07, 0.09, 0.7, 0, 0.0, -0.2, 'body'],
      [0.035, 0.035, 0.6, 0, 0.03, -0.72, 'body'],
      [0.05, 0.05, 0.3, 0, 0.11, -0.15, 'body'], // scope tube
      [0.07, 0.07, 0.06, 0, 0.11, -0.3, 'glass'],
      [0.07, 0.07, 0.06, 0, 0.11, 0.0, 'glass'],
      [0.06, 0.16, 0.08, 0, -0.1, 0.05, 'wood'],
      [0.06, 0.1, 0.32, 0, -0.01, 0.34, 'wood'],
      [0.04, 0.14, 0.06, 0, -0.12, -0.12, 'accent'],
    ],
  },
  pistol: {
    accent: 0xb0b8c4, muzzle: -0.17, parts: [
      [0.045, 0.06, 0.22, 0, 0.03, -0.04, 'body'], // slide
      [0.04, 0.05, 0.2, 0, -0.01, -0.03, 'accent'], // frame
      [0.04, 0.13, 0.06, 0, -0.1, 0.05, 'body'],
    ],
  },
});

export const WEAPON_IDS = Object.freeze(Object.keys(WEAPON_MODELS));
export const MATERIALS = Object.freeze({ body: { color: 0x2b303a, roughness: 0.45, metalness: 0.6 }, wood: { color: 0x5a3b2e, roughness: 0.7, metalness: 0.05 }, glass: { color: 0x9ad8ff, roughness: 0.1, metalness: 0.2 } });

export function weaponModel(id) {
  return WEAPON_MODELS[id] ?? WEAPON_MODELS.rifle;
}

// Length along -Z from the stock end to the muzzle, for hand placement and tests.
export function weaponLength(id) {
  const m = weaponModel(id);
  let min = Infinity, max = -Infinity;
  for (const [, , d, , , z] of m.parts) { min = Math.min(min, z - d / 2); max = Math.max(max, z + d / 2); }
  return max - min;
}
