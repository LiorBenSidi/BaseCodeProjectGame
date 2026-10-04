// Deterministic player movement. Runs on the server (authoritative) and on the client
// (prediction + replay after reconciliation). Both MUST call it with identical inputs.
//
// p   : { x, y, z, vx, vy, vz, onGround, h?, slide?, slideDx?, slideDz?, dive?, diveDx?, diveDz?,
//         tacSprint?, tacSprintCd?, wallJumps?, jumpHeld?, crouchHeld?, diveHeld?, tacSprintHeld? }
// cmd : { fwd, right, jump, yaw, pitch?, sprint?, crouch?, dive?, tacSprint? }  (fwd/right in [-1, 1])

import { INPUT_DT, PLAYER } from './constants.js';
import { MAP } from './map.js';

const R = PLAYER.radius;
const H = PLAYER.height;
const EPS = 1e-4;

export const heightOf = (p) => (typeof p.h === 'number' ? p.h : H);
// Eye and zone layout scale with the current height (crouch/dive), so camera and hit zones agree.
export const eyeOf = (p) => PLAYER.eye * (heightOf(p) / H);

function overlapsAt(p, b, h) {
  return (
    p.x + R > b.min[0] && p.x - R < b.max[0] &&
    p.y + h > b.min[1] && p.y < b.max[1] &&
    p.z + R > b.min[2] && p.z - R < b.max[2]
  );
}

function freeAt(x, y, z, h, boxes) {
  const q = { x, y, z };
  for (const b of boxes) if (overlapsAt(q, b, h)) return false;
  return true;
}

// Moves along one axis and resolves against boxes. Returns the box hit, or null.
function moveHorizontal(p, axis, delta, boxes, h) {
  if (delta === 0) return null;
  const i = axis === 'x' ? 0 : 2;
  p[axis] += delta;
  let hit = null;
  for (const b of boxes) {
    if (overlapsAt(p, b, h)) { p[axis] = delta > 0 ? b.min[i] - R - EPS : b.max[i] + R + EPS; hit = b; }
  }
  return hit;
}

// SPEC 23.3 step-up and mantle: blocked by a box whose top is within `maxRise` of the feet, with room on top.
function climb(p, hit, axis, delta, boxes, h, maxRise) {
  if (!hit) return false;
  const rise = hit.max[1] - p.y;
  if (rise <= EPS || rise > maxRise) return false;
  const i = axis === 'x' ? 0 : 2;
  const q = { x: p.x, y: hit.max[1], z: p.z };
  q[axis] = delta > 0 ? hit.min[i] + R + EPS : hit.max[i] - R - EPS;
  if (!freeAt(q.x, q.y + EPS, q.z, h, boxes)) return false;
  p.x = q.x; p.y = q.y; p.z = q.z;
  p.vy = 0;
  p.onGround = true;
  return true;
}

export function stepPlayer(p, cmd, boxes = MAP.boxes, half = MAP.half) {
  const dt = INPUT_DT;
  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);

  const jumpEdge = !!cmd.jump && !p.jumpHeld;
  const crouchEdge = !!cmd.crouch && !p.crouchHeld;
  const diveEdge = !!cmd.dive && !p.diveHeld;
  const tacSprintEdge = !!cmd.tacSprint && !p.tacSprintHeld;

  p.jumpHeld = !!cmd.jump;
  p.crouchHeld = !!cmd.crouch;
  p.diveHeld = !!cmd.dive;
  p.tacSprintHeld = !!cmd.tacSprint;

  if (p.wallJumps === undefined) p.wallJumps = PLAYER.wallJumpsPerAir;
  if (p.slide === undefined) p.slide = 0;
  if (p.dive === undefined) p.dive = 0;
  if (p.tacSprint === undefined) p.tacSprint = 0;
  if (p.tacSprintCd === undefined) p.tacSprintCd = 0;

  p.mantled = false;

  // Camera looks down -Z at yaw 0; +yaw turns left.
  let wx = -sin * cmd.fwd + cos * cmd.right;
  let wz = -cos * cmd.fwd - sin * cmd.right;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }

  // Update tactical sprint cooldown
  p.tacSprintCd = Math.max(0, p.tacSprintCd - dt);

  // Tac sprint activation (forward-only: cmd.fwd > 0.5)
  if (tacSprintEdge && cmd.fwd > 0.5 && p.onGround && p.tacSprintCd === 0 && p.slide === 0 && p.dive === 0) {
    p.tacSprint = PLAYER.tacSprintBurst;
  }

  // Manage tac sprint timer & cancellation
  if (p.tacSprint > 0) {
    if (cmd.fwd > 0.1 && !cmd.crouch && !cmd.dive && p.onGround) {
      p.tacSprint = Math.max(0, p.tacSprint - dt);
      if (p.tacSprint === 0) {
        p.tacSprintCd = PLAYER.tacSprintCooldown;
      }
    } else {
      p.tacSprint = 0;
      p.tacSprintCd = PLAYER.tacSprintCooldown;
    }
  }

  // Omnimovement sprint: any direction
  const sprinting = !!cmd.sprint && !cmd.crouch && len > 0.1 && p.slide === 0 && p.dive === 0;
  const tacSprinting = p.tacSprint > 0 && cmd.fwd > 0.1 && !cmd.crouch && p.slide === 0 && p.dive === 0;

  // Omnimovement dive: press dive or crouch-crouch while sprinting
  if (diveEdge && p.onGround && (sprinting || tacSprinting || len > 0.5) && p.dive === 0) {
    p.dive = PLAYER.diveTime;
    p.diveDx = len > 0 ? wx / len : -sin;
    p.diveDz = len > 0 ? wz / len : -cos;
    p.slide = 0;
    p.tacSprint = 0;
    p.tacSprintCd = PLAYER.tacSprintCooldown;
  }

  // Omnimovement slide
  if (crouchEdge && p.onGround && (sprinting || tacSprinting || len > 0.5) && p.slide === 0 && p.dive === 0) {
    p.slide = PLAYER.slideTime;
    p.slideDx = len > 0 ? wx / len : -sin;
    p.slideDz = len > 0 ? wz / len : -cos;
    p.tacSprint = 0;
    p.tacSprintCd = PLAYER.tacSprintCooldown;
  }

  // Slide cancel check: jumping or releasing crouch / standing within slideCancelWindow keeps momentum
  if (p.slide > 0) {
    const slideElapsed = PLAYER.slideTime - p.slide;
    if (slideElapsed <= PLAYER.slideCancelWindow && (jumpEdge || !cmd.crouch)) {
      // Keep momentum at current slide speed, cancel slide state
      const k = p.slide / PLAYER.slideTime;
      const crouchSpeed = PLAYER.speed * PLAYER.crouchMul;
      const v = crouchSpeed + (PLAYER.slideSpeed - crouchSpeed) * k;
      p.vx = p.slideDx * v;
      p.vz = p.slideDz * v;
      p.slide = 0;
    }
  }

  // Stance: crouch lowers the hitbox at once; standing up needs head room.
  const wantCrouch = !!cmd.crouch || p.slide > 0 || p.dive > 0;
  const curH = heightOf(p);
  let h = curH;
  if (wantCrouch) h = PLAYER.crouchHeight;
  else if (curH < H) h = freeAt(p.x, p.y, p.z, H, boxes) ? H : curH;
  p.h = h;

  if (p.dash > 0) {
    // Vanguard dash burst
    p.vx = p.dashDx * PLAYER.dashSpeed;
    p.vz = p.dashDz * PLAYER.dashSpeed;
    p.dash = Math.max(0, p.dash - dt);
    p.slide = 0;
    p.dive = 0;
  } else if (p.dive > 0 && p.onGround) {
    p.vx = p.diveDx * PLAYER.diveSpeed;
    p.vz = p.diveDz * PLAYER.diveSpeed;
    p.dive = Math.max(0, p.dive - dt);
  } else if (p.slide > 0 && p.onGround) {
    const k = p.slide / PLAYER.slideTime;
    const crouchSpeed = PLAYER.speed * PLAYER.crouchMul;
    const v = crouchSpeed + (PLAYER.slideSpeed - crouchSpeed) * k;
    p.vx = p.slideDx * v;
    p.vz = p.slideDz * v;
    p.slide = Math.max(0, p.slide - dt);
  } else if (p.onGround) {
    if (p.slide > 0) p.slide = 0;
    if (p.dive > 0) p.dive = 0;
    let speed = PLAYER.speed;
    if (h < H) speed *= PLAYER.crouchMul;
    else if (tacSprinting) speed = PLAYER.speed * PLAYER.tacSprintMul;
    else if (sprinting) speed = PLAYER.speed * PLAYER.sprintMul;
    p.vx = wx * speed;
    p.vz = wz * speed;
  } else {
    // Airborne: air control accelerates toward target velocity
    let wantSpeed = PLAYER.speed;
    if (tacSprinting) wantSpeed = PLAYER.speed * PLAYER.tacSprintMul;
    else if (sprinting) wantSpeed = PLAYER.speed * PLAYER.sprintMul;
    const tx = wx * wantSpeed;
    const tz = wz * wantSpeed;
    const maxDv = PLAYER.airAccel * dt;
    const dx = tx - p.vx;
    const dz = tz - p.vz;
    const d = Math.hypot(dx, dz);
    if (len > 0 && d > 0) {
      const k = Math.min(1, maxDv / d);
      p.vx += dx * k;
      p.vz += dz * k;
    }
  }

  if (cmd.jump && p.onGround) {
    p.vy = PLAYER.jump;
    p.onGround = false;
    p.slide = 0;
    p.dive = 0;
  }
  p.vy -= PLAYER.gravity * dt;

  const wasGround = p.onGround;
  const hitX = moveHorizontal(p, 'x', p.vx * dt, boxes, h);
  const hitZ = moveHorizontal(p, 'z', p.vz * dt, boxes, h);

  // Step-up / Mantle
  let climbed = false;
  if (hitX || hitZ) {
    const maxRise = wasGround ? PLAYER.stepHeight : (p.vy <= PLAYER.jump * 0.5 ? PLAYER.mantleHeight : 0);
    climbed = climb(p, hitX, 'x', p.vx * dt, boxes, h, maxRise) || climb(p, hitZ, 'z', p.vz * dt, boxes, h, maxRise);
    if (climbed && !wasGround) {
      p.mantled = true;
    }
    // Wall jump
    if (!climbed && !wasGround && jumpEdge && p.wallJumps > 0) {
      p.wallJumps -= 1;
      p.vy = PLAYER.jump * PLAYER.wallJumpMul;
      const hit = hitX || hitZ;
      const axis = hitX ? 'x' : 'z';
      const i = axis === 'x' ? 0 : 2;
      const away = p[axis] < (hit.min[i] + hit.max[i]) / 2 ? -1 : 1;
      if (axis === 'x') { p.vx = away * PLAYER.wallJumpPush; } else { p.vz = away * PLAYER.wallJumpPush; }
    }
  }

  p.onGround = false;
  p.y += p.vy * dt;
  for (const b of boxes) {
    if (!overlapsAt(p, b, h)) continue;
    if (p.vy <= 0) {
      p.y = b.max[1];
      p.vy = 0;
      p.onGround = true;
    } else {
      p.y = b.min[1] - h - EPS;
      p.vy = 0;
    }
  }
  if (p.y <= 0) {
    p.y = 0;
    if (p.vy < 0) p.vy = 0;
    p.onGround = true;
  }
  if (climbed && p.vy === 0) p.onGround = true;
  if (p.onGround) p.wallJumps = PLAYER.wallJumpsPerAir;

  const lim = half - R;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return p;
}
