// Deterministic player movement. Runs on the server (authoritative) and on the client
// (prediction + replay after reconciliation). Both MUST call it with identical inputs.
//
// p   : { x, y, z, vx, vy, vz, onGround, h?, slide?, slideDx?, slideDz?, wallJumps?, jumpHeld?, crouchHeld? }
//       (y = feet position; the SPEC 23 fields are created on first use so Milestone 1 callers keep working)
// cmd : { fwd, right, jump, yaw, sprint?, crouch? }  (fwd/right in [-1, 1])

import { INPUT_DT, PLAYER } from './constants.js';
import { MAP } from './map.js';

const R = PLAYER.radius;
const H = PLAYER.height;
const EPS = 1e-4;

export const heightOf = (p) => (typeof p.h === 'number' ? p.h : H);
// Eye and zone layout scale with the current height (crouch), so the camera and hit zones agree.
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
  p.jumpHeld = !!cmd.jump;
  p.crouchHeld = !!cmd.crouch;
  if (p.wallJumps === undefined) p.wallJumps = PLAYER.wallJumpsPerAir;
  if (p.slide === undefined) p.slide = 0;

  // Camera looks down -Z at yaw 0; +yaw turns left.
  let wx = -sin * cmd.fwd + cos * cmd.right;
  let wz = -cos * cmd.fwd - sin * cmd.right;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }

  // SPEC 23.1 stance: crouch lowers the hitbox at once; standing up needs head room.
  const wantCrouch = !!cmd.crouch || p.slide > 0;
  const curH = heightOf(p);
  let h = curH;
  if (wantCrouch) h = PLAYER.crouchHeight;
  else if (curH < H) h = freeAt(p.x, p.y, p.z, H, boxes) ? H : curH;
  p.h = h;

  // SPEC 23.2 slide: sprinting on the ground and tapping crouch while moving.
  const sprinting = !!cmd.sprint && !cmd.crouch && cmd.fwd > 0 && p.slide === 0;
  if (crouchEdge && p.onGround && !!cmd.sprint && len > 0.5 && p.slide === 0) {
    p.slide = PLAYER.slideTime;
    p.slideDx = wx / len;
    p.slideDz = wz / len;
  }

  let speed = PLAYER.speed;
  if (p.dash > 0) {
    // SPEC 24.2 dash: a fixed-speed burst in a locked direction, on the ground or in the air; gravity still applies.
    p.vx = p.dashDx * PLAYER.dashSpeed;
    p.vz = p.dashDz * PLAYER.dashSpeed;
    p.dash = Math.max(0, p.dash - dt);
    p.slide = 0;
  } else if (p.slide > 0 && p.onGround) {
    const k = p.slide / PLAYER.slideTime; // 1 at the start, 0 at the end
    const crouchSpeed = PLAYER.speed * PLAYER.crouchMul;
    const v = crouchSpeed + (PLAYER.slideSpeed - crouchSpeed) * k;
    p.vx = p.slideDx * v;
    p.vz = p.slideDz * v;
    p.slide = Math.max(0, p.slide - dt);
  } else if (p.onGround) {
    if (p.slide > 0) p.slide = 0; // left the ground mid slide: the slide ends, the speed is kept below
    if (h < H) speed *= PLAYER.crouchMul;
    else if (sprinting) speed *= PLAYER.sprintMul;
    p.vx = wx * speed;
    p.vz = wz * speed;
  } else {
    // SPEC 23.4 air control: accelerate toward the wanted velocity instead of snapping to it.
    const tx = wx * speed;
    const tz = wz * speed;
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
  }
  p.vy -= PLAYER.gravity * dt;

  const wasGround = p.onGround;
  const hitX = moveHorizontal(p, 'x', p.vx * dt, boxes, h);
  const hitZ = moveHorizontal(p, 'z', p.vz * dt, boxes, h);

  // SPEC 23.3: walking into a low ledge climbs it; jumping into a taller one grabs it.
  let climbed = false;
  if (hitX || hitZ) {
    const maxRise = wasGround ? PLAYER.stepHeight : (p.vy <= PLAYER.jump * 0.5 ? PLAYER.mantleHeight : 0);
    climbed = climb(p, hitX, 'x', p.vx * dt, boxes, h, maxRise) || climb(p, hitZ, 'z', p.vz * dt, boxes, h, maxRise);
    // SPEC 23.5 wall jump: airborne, pressed against a wall, a fresh jump press, one per airtime.
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
  if (climbed && p.vy === 0) p.onGround = true; // feet exactly on the ledge top count as standing
  if (p.onGround) p.wallJumps = PLAYER.wallJumpsPerAir;

  const lim = half - R;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return p;
}
