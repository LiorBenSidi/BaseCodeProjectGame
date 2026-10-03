// Hit-scan helpers (server-side authority; the client only uses aimDir for nothing critical).

import { PLAYER } from './constants.js';

// Direction for camera rotation order YXZ (yaw about Y, then pitch about X). Matches movement.js.
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function playerBox(p) {
  const R = PLAYER.radius;
  return { min: [p.x - R, p.y, p.z - R], max: [p.x + R, p.y + PLAYER.height, p.z + R] };
}

// Slab test. Returns distance t >= 0 along a normalised dir, or null on miss.
export function rayAabb(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// Casts against static boxes and player targets [{ id, box }].
// Returns { t, targetId }; targetId is null when a wall (or max range) is hit first.
export function castRay(origin, dir, range, boxes, targets) {
  let t = range;
  for (const b of boxes) {
    const h = rayAabb(origin, dir, b.min, b.max);
    if (h !== null && h < t) t = h;
  }
  let targetId = null;
  for (const tg of targets) {
    const h = rayAabb(origin, dir, tg.box.min, tg.box.max);
    if (h !== null && h < t) { t = h; targetId = tg.id; }
  }
  return { t, targetId };
}
