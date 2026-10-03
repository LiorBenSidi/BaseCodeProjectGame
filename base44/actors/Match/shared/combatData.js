// Combat tuning as data (docs/SPEC.md §15.1). Changing a number here changes gameplay for both sides.

// D-010: five damage categories. Both arms share one multiplier.
export const ZONE_MULTIPLIERS = Object.freeze({ head: 1.5, upperTorso: 1.1, lowerTorso: 1.0, arms: 0.95, legs: 0.9 });

// Zone boundaries in metres above the feet, inside the 1.8 m hitbox. armOffset is the lateral half-width of
// the torso; anything further out at torso height is an arm.
export const ZONE_LAYOUT = Object.freeze({ legsTop: 0.9, lowerTorsoTop: 1.15, upperTorsoTop: 1.5, armOffset: 0.25 });

// D-011, D-014: three distance bands; `below` is exclusive.
export const RIFLE = Object.freeze({
  range: 120,
  cooldownMs: 150,
  bands: Object.freeze([
    Object.freeze({ below: 20, damage: 25 }),
    Object.freeze({ below: 40, damage: 22 }),
    Object.freeze({ below: 120, damage: 18 }),
  ]),
});

// D-015: one frag grenade per life, no cooking.
export const GRENADE = Object.freeze({
  fuseMs: 3000,
  speed: 16,
  gravity: 24,
  restitution: 0.45,
  radius: 0.1,
  blastRadius: 5,
  maxDamage: 100,
  substepHz: 120,
  perLife: 1,
});
