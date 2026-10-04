// SPEC 32.5 aim assist, for sticks and touch only, never for the mouse. Pure: game.js feeds it the view, the raw turn
// and the live enemies, and it returns the bent turn. Two effects, both small, both on the client view angles only
// (the server never sees them, hits are still resolved from the real view ray):
//   slowdown: inside the cone the turn is scaled by `slowdownMul`, so a stick overshoots less;
//   rotational: while the player turns or moves, the view drifts toward the target by `rotationalAssist` of the
//               remaining angle per update (at 60 Hz that is a gentle pull, not a snap).

export const AIM_ASSIST = Object.freeze({
  coneDeg: 10, // half-angle of the assist cone
  slowdownMul: 0.6,
  rotationalAssist: 0.035,
  maxDistance: 60, // m
  minDistance: 1.5, // m, too close: assist would spin the camera
});

// Forward unit vector of the camera (yaw 0 looks down -Z, +yaw turns left; +pitch looks up).
export function viewDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

// Picks the target closest to the view centre inside the cone, or null.
export function findTargetInCone(player, targets, coneDeg = AIM_ASSIST.coneDeg, cfg = AIM_ASSIST) {
  if (!player || !Array.isArray(targets) || targets.length === 0) return null;
  const coneRad = (coneDeg * Math.PI) / 180;
  const v = viewDir(player.yaw, player.pitch);
  let best = null;
  for (const t of targets) {
    if (!t || typeof t.x !== 'number' || typeof t.z !== 'number') continue;
    const dx = t.x - player.x;
    const dy = (typeof t.y === 'number' ? t.y : player.y) - player.y;
    const dz = t.z - player.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < cfg.minDistance || dist > cfg.maxDistance) continue;
    const dir = [dx / dist, dy / dist, dz / dist];
    const dot = Math.max(-1, Math.min(1, v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]));
    const angle = Math.acos(dot);
    if (angle < coneRad && (!best || angle < best.angle)) best = { target: t, angle, dist, dir };
  }
  return best;
}

export function applyAimAssist(params = {}) {
  const {
    inputType = 'mouse',
    aimDelta = { dyaw: 0, dpitch: 0 },
    player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    targets = [],
    moving = false,
    config = AIM_ASSIST,
  } = params;
  let { dyaw, dpitch } = aimDelta;
  if (inputType !== 'gamepad' && inputType !== 'touch') return { dyaw, dpitch, target: null };
  const match = findTargetInCone(player, targets, config.coneDeg, config);
  if (!match) return { dyaw, dpitch, target: null };

  dyaw *= config.slowdownMul;
  dpitch *= config.slowdownMul;

  const turning = Math.abs(aimDelta.dyaw) > 1e-5 || Math.abs(aimDelta.dpitch) > 1e-5;
  if (turning || moving) {
    const targetYaw = Math.atan2(-match.dir[0], -match.dir[2]);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, match.dir[1])));
    let yawDiff = targetYaw - player.yaw;
    while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;
    dyaw += yawDiff * config.rotationalAssist;
    dpitch += (targetPitch - player.pitch) * config.rotationalAssist;
  }
  return { dyaw, dpitch, target: match.target };
}
