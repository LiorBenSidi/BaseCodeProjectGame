// Aim assist for gamepad and touch input (never mouse) (SPEC 32).
// Pure module: applies slowdown zone and light rotational assist toward the nearest target within a cone.

export function findTargetInCone(player, targets, coneDeg = 12) {
  if (!player || !Array.isArray(targets) || targets.length === 0) return null;
  const coneRad = (coneDeg * Math.PI) / 180;

  const cosP = Math.cos(player.pitch);
  const vx = -Math.sin(player.yaw) * cosP;
  const vy = Math.sin(player.pitch);
  const vz = -Math.cos(player.yaw) * cosP;

  let bestTarget = null;
  let minAngle = coneRad;

  for (const t of targets) {
    if (!t || typeof t.x !== 'number' || typeof t.y !== 'number' || typeof t.z !== 'number') continue;
    const dx = t.x - player.x;
    const dy = (t.y ?? player.y) - player.y;
    const dz = t.z - player.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.1 || dist > 100) continue;

    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    const dot = Math.max(-1, Math.min(1, vx * nx + vy * ny + vz * nz));
    const angle = Math.acos(dot);

    if (angle < minAngle) {
      minAngle = angle;
      bestTarget = { target: t, angle, dist, dir: [nx, ny, nz] };
    }
  }

  return bestTarget;
}

export function applyAimAssist(params = {}) {
  const {
    inputType = 'mouse',
    aimDelta = { dyaw: 0, dpitch: 0 },
    player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    targets = [],
    moving = false,
    config = { coneDeg: 12, slowdownMul: 0.5, rotationalAssist: 0.15 },
  } = params;

  let { dyaw, dpitch } = aimDelta;

  // Rule: Mouse input NEVER receives aim assist
  if (inputType === 'mouse') {
    return { dyaw, dpitch };
  }

  if (inputType !== 'gamepad' && inputType !== 'touch') {
    return { dyaw, dpitch };
  }

  const match = findTargetInCone(player, targets, config.coneDeg);
  if (!match) {
    return { dyaw, dpitch };
  }

  // Slowdown zone: reduce aim sensitivity when aiming near target
  dyaw *= config.slowdownMul;
  dpitch *= config.slowdownMul;

  // Rotational assist: if player is turning stick or moving, add light pull toward target center
  const isTurning = Math.abs(aimDelta.dyaw) > 1e-5 || Math.abs(aimDelta.dpitch) > 1e-5;
  if (isTurning || moving) {
    const targetYaw = Math.atan2(-match.dir[0], -match.dir[2]);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, match.dir[1])));

    let yawDiff = targetYaw - player.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

    const pitchDiff = targetPitch - player.pitch;

    dyaw += yawDiff * config.rotationalAssist;
    dpitch += pitchDiff * config.rotationalAssist;
  }

  return { dyaw, dpitch };
}
