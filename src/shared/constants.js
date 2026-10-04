// Shared by client AND server. Changing any value here changes gameplay for both sides at once.

export const TICK_RATE = 30; // server simulation + snapshot rate (Hz)
export const INPUT_DT = 1 / 60; // fixed timestep of one input command; the server ignores client-claimed dt
export const MAX_PLAYERS = 16;

// SPEC 17.3 diagnostics gate. A deployed actor receives no app secret from the platform (only its own
// config strings and keypair), so the probe is enabled by the room id instead: rooms whose id starts with
// this prefix answer { t: "diag" } and carry error details; every other room keeps the protocol strike.
// The lobby never hands out such an id, and the actor holds nothing secret to leak.
export const DIAG_ROOM_PREFIX = 'diag-';
export function isDiagRoom(roomId) {
  return typeof roomId === 'string' && roomId.startsWith(DIAG_ROOM_PREFIX);
}

export const PLAYER = {
  radius: 0.4, // half-width of the AABB hitbox
  height: 1.8,
  eye: 1.6, // camera height above feet
  speed: 7, // m/s
  jump: 8, // m/s initial vertical velocity
  gravity: 24, // m/s^2
  // SPEC 23 movement set (D-022). All in metres, seconds or multipliers of `speed`.
  sprintMul: 1.35, // forward-ish input only
  crouchHeight: 1.2, // hitbox height while crouched or sliding
  crouchMul: 0.55, // ground speed while crouched
  airAccel: 30, // m/s^2 toward the wanted horizontal velocity while airborne (air control)
  stepHeight: 0.55, // a ledge this high is climbed while walking, no jump needed
  mantleHeight: 1.5, // a ledge up to this high is grabbed while airborne and moving into it
  slideSpeed: 11, // m/s at the start of a slide, decaying to crouch speed over slideTime
  slideTime: 0.7, // s
  wallJumpPush: 6, // m/s away from the wall
  wallJumpMul: 0.9, // of `jump`
  wallJumpsPerAir: 1,
  dashSpeed: 18, // SPEC 24.2 Vanguard dash burst speed (m/s); its duration is ABILITIES.dash.time
};

export const WEAPON = {
  damage: 25,
  range: 120,
  cooldownMs: 150,
};

export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
