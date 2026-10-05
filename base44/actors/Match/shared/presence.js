// Radar pulse and AFK rules as data plus pure helpers (docs/SPEC.md section 37, D-036).
// Shared so the client can draw the pulse on the same clock the server reveals on.

export const RADAR = Object.freeze({
  periodMs: 5000, // deathmatch only: every 5 s every player is revealed on the minimap
  showMs: 1500, // the reveal lasts this long, then dots fade with the client's own reveal timer
});

export const AFK = Object.freeze({
  idleMs: 60_000, // no active input for this long marks a human AFK (dm and tdm only; never in the range)
});

// A command counts as activity when the player actually does something: moves, jumps, sprints, crouches,
// or turns. A client that is just connected keeps sending zero commands at 60 Hz; those do not count.
export function cmdIsActive(cmd, prevYaw = cmd?.yaw, prevPitch = cmd?.pitch) {
  if (!cmd) return false;
  if (cmd.fwd !== 0 || cmd.right !== 0) return true;
  if (cmd.jump || cmd.sprint || cmd.crouch || cmd.dive || cmd.tac) return true;
  return Math.abs(cmd.yaw - prevYaw) > 1e-4 || Math.abs(cmd.pitch - prevPitch) > 1e-4;
}

// True while the radar reveal is on. `elapsedMs` is time since the match went live, so every player
// (and the client's pulse ring) agrees on the phase. The reveal sits at the END of each period, so the
// first pulse comes 3.5 s into the match, not at the spawn.
export function radarActive(modeId, elapsedMs) {
  if (modeId !== 'dm' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return elapsedMs % RADAR.periodMs >= RADAR.periodMs - RADAR.showMs;
}

// Milliseconds until the next pulse starts, for the HUD countdown ring. 0 while a pulse is showing.
export function radarNextIn(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return RADAR.periodMs;
  const phase = elapsedMs % RADAR.periodMs;
  const startAt = RADAR.periodMs - RADAR.showMs;
  return phase >= startAt ? 0 : startAt - phase;
}

export function afkEligible(modeId) {
  return modeId === 'dm' || modeId === 'tdm';
}

export function isAfk(lastActiveAt, now, idleMs = AFK.idleMs) {
  return now - lastActiveAt >= idleMs;
}
