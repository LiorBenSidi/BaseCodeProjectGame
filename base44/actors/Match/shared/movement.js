// Deterministic player movement. Runs on the server (authoritative) and on the client
// (prediction + replay after reconciliation). Both MUST call it with identical inputs.
//
// p   : { x, y, z, vx, vy, vz, onGround }   (y = feet position)
// cmd : { fwd, right, jump, yaw }           (fwd/right in [-1, 1])

import { INPUT_DT, PLAYER } from './constants.js';
import { MAP } from './map.js';

const R = PLAYER.radius;
const H = PLAYER.height;
const EPS = 1e-4;

function overlaps(p, b) {
  return (
    p.x + R > b.min[0] && p.x - R < b.max[0] &&
    p.y + H > b.min[1] && p.y < b.max[1] &&
    p.z + R > b.min[2] && p.z - R < b.max[2]
  );
}

function moveHorizontal(p, axis, delta, boxes) {
  if (delta === 0) return;
  const i = axis === 'x' ? 0 : 2;
  p[axis] += delta;
  for (const b of boxes) {
    if (overlaps(p, b)) p[axis] = delta > 0 ? b.min[i] - R - EPS : b.max[i] + R + EPS;
  }
}

export function stepPlayer(p, cmd, boxes = MAP.boxes, half = MAP.half) {
  const dt = INPUT_DT;
  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);

  // Camera looks down -Z at yaw 0; +yaw turns left.
  let wx = -sin * cmd.fwd + cos * cmd.right;
  let wz = -cos * cmd.fwd - sin * cmd.right;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }

  p.vx = wx * PLAYER.speed;
  p.vz = wz * PLAYER.speed;

  if (cmd.jump && p.onGround) {
    p.vy = PLAYER.jump;
    p.onGround = false;
  }
  p.vy -= PLAYER.gravity * dt;

  moveHorizontal(p, 'x', p.vx * dt, boxes);
  moveHorizontal(p, 'z', p.vz * dt, boxes);

  p.onGround = false;
  p.y += p.vy * dt;
  for (const b of boxes) {
    if (!overlaps(p, b)) continue;
    if (p.vy <= 0) {
      p.y = b.max[1];
      p.vy = 0;
      p.onGround = true;
    } else {
      p.y = b.min[1] - H - EPS;
      p.vy = 0;
    }
  }
  if (p.y <= 0) {
    p.y = 0;
    if (p.vy < 0) p.vy = 0;
    p.onGround = true;
  }

  const lim = half - R;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return p;
}
