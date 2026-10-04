// Hit zones, range bands and the single damage function (docs/SPEC.md §15.2). Pure and deterministic:
// shots resolve from poses and rays only, so the result never depends on the room's tick rate.

import { castRay, playerBox } from './hitscan.js';
import { ZONE_LAYOUT, ZONE_MULTIPLIERS } from './combatData.js';
import { heightOf } from './movement.js';
import { PLAYER } from './constants.js';

const round2 = (v) => Math.round(v * 100) / 100;

export function zoneAt(p, point) {
  // SPEC 23: zones scale with the current height, so a crouched head is still a head.
  const h = (point.y - p.y) * (PLAYER.height / heightOf(p));
  if (h >= ZONE_LAYOUT.upperTorsoTop) return 'head';
  if (h < ZONE_LAYOUT.legsTop) return 'legs';
  // The target's right vector at its yaw (yaw 0 faces -Z, right is +X).
  const lateral = (point.x - p.x) * Math.cos(p.yaw) - (point.z - p.z) * Math.sin(p.yaw);
  if (Math.abs(lateral) > ZONE_LAYOUT.armOffset) return 'arms';
  return h >= ZONE_LAYOUT.lowerTorsoTop ? 'upperTorso' : 'lowerTorso';
}

export function bandDamage(weapon, dist) {
  for (const band of weapon.bands) if (dist < band.below) return band.damage;
  return 0;
}

export function shotDamage(weapon, zone, dist) {
  return round2(bandDamage(weapon, dist) * ZONE_MULTIPLIERS[zone]);
}

// The one damage path for bullets and explosions.
export function applyDamage(target, amount) {
  if (!(amount > 0) || target.hp <= 0) return { applied: 0, killed: false };
  const applied = Math.min(target.hp, amount);
  target.hp = Math.max(0, round2(target.hp - applied));
  return { applied, killed: target.hp === 0 };
}

export function resolveShot(origin, dir, weapon, boxes, targets) {
  const { t, targetId } = castRay(origin, dir, weapon.range, boxes, targets.map(({ id, p }) => ({ id, box: playerBox(p) })));
  if (targetId === null) return { t, targetId: null, zone: null, dist: round2(t), damage: 0 };
  const { p } = targets.find((tg) => tg.id === targetId);
  const zone = zoneAt(p, { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, z: origin[2] + dir[2] * t });
  return { t, targetId, zone, dist: round2(t), damage: shotDamage(weapon, zone, t) };
}
