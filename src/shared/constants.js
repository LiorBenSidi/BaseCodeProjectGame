// Shared by client AND server. Changing any value here changes gameplay for both sides at once.

export const TICK_RATE = 30; // server simulation + snapshot rate (Hz)
export const INPUT_DT = 1 / 60; // fixed timestep of one input command; the server ignores client-claimed dt
export const MAX_PLAYERS = 16;

export const PLAYER = {
  radius: 0.4, // half-width of the AABB hitbox
  height: 1.8,
  eye: 1.6, // camera height above feet
  speed: 7, // m/s
  jump: 8, // m/s initial vertical velocity
  gravity: 24, // m/s^2
};

export const WEAPON = {
  damage: 25,
  range: 120,
  cooldownMs: 150,
};

export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
