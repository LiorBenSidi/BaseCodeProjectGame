// Match rules as data (docs/SPEC.md section 21, D-020 / D-021). Shared so the client can show the same numbers.

export const SPAWN = Object.freeze({
  protectMs: 2000, // no damage taken after a respawn, cleared early by the player's first shot
});

export const PICKUP = Object.freeze({
  radius: 1.2, // horizontal distance from the player's feet to the spot
  heightTolerance: 1.5, // the spot must be within this of the player's feet vertically
});

// Type table. `respawnMs` is how long a spot stays empty after it is taken.
export const PICKUP_TYPES = Object.freeze({
  health: Object.freeze({ id: 'health', amount: 50, respawnMs: 20_000 }),
  ammo: Object.freeze({ id: 'ammo', magazines: 1, respawnMs: 15_000 }),
  smg: Object.freeze({ id: 'smg', weapon: 'smg', respawnMs: 30_000 }),
  shotgun: Object.freeze({ id: 'shotgun', weapon: 'shotgun', respawnMs: 30_000 }),
  sniper: Object.freeze({ id: 'sniper', weapon: 'sniper', respawnMs: 45_000 }),
});
