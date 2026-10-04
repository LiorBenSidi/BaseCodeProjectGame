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

// SPEC 32 tuning (D-029: BO6 Omnimovement & Feel).
export const PLAYER = {
  radius: 0.4, // half-width of the AABB hitbox
  height: 1.8,
  eye: 1.6, // camera height above feet
  // SPEC 32 tuning (D-029, BO6 reference): walk 5.6, sprint 7.2, tactical sprint 8.5 m/s, 1.0 m jump apex.
  speed: 5.6, // m/s, walking
  jump: 8, // m/s initial vertical velocity
  gravity: 32, // m/s^2; apex = jump^2 / (2 gravity) = 1.0 m
  // SPEC 23 movement set (D-022), retuned by SPEC 32. All in metres, seconds or multipliers of `speed`.
  sprintMul: 7.2 / 5.6, // SPEC 32.1: sprint in any direction (omnimovement)
  tacSprintMul: 8.5 / 5.6, // SPEC 32.2: tactical sprint, forward only, in bursts
  tacBurst: 2.5, // s of tactical sprint per press
  tacCooldown: 4, // s before the next tactical sprint
  crouchHeight: 1.2, // hitbox height while crouched, sliding or diving
  crouchMul: 0.5, // ground speed while crouched
  airAccel: 12, // m/s^2 toward the wanted horizontal velocity while airborne (air control, weighty jumps)
  stepHeight: 0.55, // a ledge this high is climbed while walking, no jump needed
  mantleHeight: 1.5, // a ledge up to this high is grabbed while airborne and moving into it
  slideSpeed: 10, // m/s at the start of a slide, decaying to crouch speed over slideTime
  slideTime: 0.65, // s
  slideCancelWindow: 0.25, // s from the slide start in which a jump keeps the slide velocity (slide cancel)
  diveTime: 0.6, // s in the low dive state
  diveSpeed: 2.5 / 0.6, // m/s, so a dive covers 2.5 m
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
