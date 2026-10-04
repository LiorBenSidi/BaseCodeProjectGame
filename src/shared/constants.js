// Shared by client AND server. Changing any value here changes gameplay for both sides at once.

export const TICK_RATE = 30; // server simulation + snapshot rate (Hz)
export const INPUT_DT = 1 / 60; // fixed timestep of one input command; the server ignores client-claimed dt
export const MAX_PLAYERS = 16;

// SPEC 17.3 diagnostics gate.
export const DIAG_ROOM_PREFIX = 'diag-';
export function isDiagRoom(roomId) {
  return typeof roomId === 'string' && roomId.startsWith(DIAG_ROOM_PREFIX);
}

// SPEC 32 tuning (D-029: BO6 Omnimovement & Feel).
export const PLAYER = {
  radius: 0.4, // half-width of the AABB hitbox (m)
  height: 1.8, // standing height (m)
  eye: 1.6, // standing eye height above feet (m)
  speed: 5.6, // base walk speed (m/s)
  jump: 8, // initial vertical jump velocity (m/s)
  gravity: 32, // gravity acceleration (m/s^2), yields 1.0 m jump apex (v0^2 / 2g = 64/64 = 1.0 m)
  sprintMul: 7.2 / 5.6, // sprint speed multiplier (~1.2857 -> 7.2 m/s in any direction)
  tacSprintMul: 8.5 / 5.6, // tactical sprint speed multiplier (~1.5179 -> 8.5 m/s forward-only)
  tacSprintBurst: 2.5, // tactical sprint burst duration (s)
  tacSprintCooldown: 4.0, // tactical sprint cooldown duration (s)
  crouchHeight: 1.2, // hitbox height while crouched, sliding or diving (m)
  crouchMul: 0.5, // ground speed multiplier while crouched (2.8 m/s)
  airAccel: 12, // air control acceleration (m/s^2), reduced so jumps feel weighty
  stepHeight: 0.55, // auto step-up ledge height while walking (m)
  mantleHeight: 1.5, // airborne mantle ledge height (m)
  slideSpeed: 10, // initial slide speed (m/s)
  slideTime: 0.65, // slide duration (s)
  slideCancelWindow: 0.25, // slide cancel window from start of slide (s) where jumping/standing keeps momentum
  diveSpeed: 2.5 / 0.6, // horizontal dive speed (m/s), covers 2.5 m over 0.6 s duration
  diveTime: 0.6, // dive duration (s)
  wallJumpPush: 6, // wall jump push velocity away from wall (m/s)
  wallJumpMul: 0.9, // wall jump vertical velocity multiplier of `jump`
  wallJumpsPerAir: 1, // wall jumps allowed per airtime
  dashSpeed: 18, // Vanguard dash burst speed (m/s)
};

export const WEAPON = {
  damage: 25,
  range: 120,
  cooldownMs: 150,
};

export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
