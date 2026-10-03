// Grenade simulation (docs/SPEC.md §15.3). Fixed 1/120 s sub-steps and an integer fuse counter make the
// flight and the 3 s fuse identical whether the room ticks at 30, 60 or 120 Hz.

import { GRENADE } from './combatData.js';
import { playerBox, rayAabb } from './hitscan.js';

const AXES = [['x', 'vx', 0], ['y', 'vy', 1], ['z', 'vz', 2]];
const round2 = (v) => Math.round(v * 100) / 100;

export function launchGrenade(id, owner, origin, dir) {
  return {
    id,
    owner,
    x: origin[0], y: origin[1], z: origin[2],
    vx: dir[0] * GRENADE.speed, vy: dir[1] * GRENADE.speed, vz: dir[2] * GRENADE.speed,
    stepsLeft: Math.round((GRENADE.fuseMs / 1000) * GRENADE.substepHz),
    exploded: false,
  };
}

function blocked(g, boxes, half) {
  const r = GRENADE.radius;
  if (g.y < r || Math.abs(g.x) > half - r || Math.abs(g.z) > half - r) return true;
  for (const b of boxes) {
    if (g.x - r < b.max[0] && g.x + r > b.min[0] && g.y - r < b.max[1] && g.y + r > b.min[1]
      && g.z - r < b.max[2] && g.z + r > b.min[2]) return true;
  }
  return false;
}

export function stepGrenade(g, dt, boxes, half) {
  const h = 1 / GRENADE.substepHz;
  const n = Math.max(1, Math.round(dt * GRENADE.substepHz));
  for (let i = 0; i < n && !g.exploded; i++) {
    g.vy -= GRENADE.gravity * h;
    for (const [pos, vel, axis] of AXES) {
      const prev = g[pos];
      g[pos] += g[vel] * h;
      if (!blocked(g, boxes, half)) continue;
      g[pos] = prev;
      g[vel] = -g[vel] * GRENADE.restitution;
      if (axis === 1) {
        // Vertical contact (floor or box top): friction on the ground, and small bounces settle.
        g.vx *= GRENADE.restitution;
        g.vz *= GRENADE.restitution;
        if (Math.abs(g.vy) < 0.5) g.vy = 0;
      }
    }
    g.stepsLeft -= 1;
    if (g.stepsLeft <= 0) g.exploded = true;
  }
  return g;
}

export function blastDamage(center, p, boxes) {
  const { min, max } = playerBox(p);
  const point = [0, 1, 2].map((i) => Math.min(max[i], Math.max(min[i], center[i])));
  const d = Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]);
  if (d >= GRENADE.blastRadius) return 0;
  if (d > 0) {
    const dir = [(point[0] - center[0]) / d, (point[1] - center[1]) / d, (point[2] - center[2]) / d];
    for (const b of boxes) {
      const t = rayAabb(center, dir, b.min, b.max);
      if (t !== null && t < d) return 0;
    }
  }
  return round2(GRENADE.maxDamage * (1 - d / GRENADE.blastRadius));
}
