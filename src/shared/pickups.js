// Pickups: spots on the map that hand out health, ammo or a primary weapon (docs/SPEC.md section 21.1).
// Pure: the room owns the state array this module builds and steps; time is `nowMs` from the caller.

import { MAX_HP } from './constants.js';
import { PICKUP, PICKUP_TYPES } from './rules.js';
import { addReserve, newWeaponState, weaponDef } from './weapons.js';

const round2 = (v) => Math.round(v * 100) / 100;

// Validates a map's pickup list once; the room keeps the result.
export function buildPickups(spots) {
  const out = [];
  for (const s of spots ?? []) {
    const type = PICKUP_TYPES[s.type];
    if (!type || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
    out.push({ i: out.length, type: type.id, x: s.x, y: Number.isFinite(s.y) ? s.y : 0, z: s.z, availableAt: -Infinity });
  }
  return out;
}

export const isAvailable = (pk, nowMs) => nowMs >= pk.availableAt;

export function inReach(pk, p) {
  if (Math.abs(pk.y - p.y) > PICKUP.heightTolerance) return false;
  return Math.hypot(pk.x - p.x, pk.z - p.z) <= PICKUP.radius;
}

// Applies one pickup to a player. Returns null when the player gains nothing (full health, full reserve),
// so the spot stays for someone who needs it; otherwise { kind, amount } for the client message.
export function applyPickup(pk, p) {
  const type = PICKUP_TYPES[pk.type];
  if (type.amount !== undefined) {
    if (p.hp >= MAX_HP) return null;
    const before = p.hp;
    p.hp = round2(Math.min(MAX_HP, p.hp + type.amount));
    return { kind: 'health', amount: round2(p.hp - before) };
  }
  if (type.magazines !== undefined) {
    const ws = p.loadout[p.loadout.active];
    const added = addReserve(ws, weaponDef(ws.id).magSize * type.magazines);
    return added > 0 ? { kind: 'ammo', amount: added } : null;
  }
  if (type.weapon !== undefined) {
    const current = p.loadout.primary;
    if (current.id === type.weapon && current.mag >= weaponDef(current.id).magSize && current.reserve >= weaponDef(current.id).reserve) return null;
    p.loadout.primary = newWeaponState(type.weapon);
    if (p.loadout.active === 'primary') p.loadout.switchingUntil = -Infinity;
    return { kind: 'weapon', amount: 0, weapon: type.weapon };
  }
  return null;
}

// One tick of pickup logic for every living player. Returns [{ playerId, i, kind, amount, weapon? }].
export function stepPickups(pickups, players, nowMs) {
  const taken = [];
  for (const pk of pickups) {
    if (!isAvailable(pk, nowMs)) continue;
    for (const p of players) {
      if (!p.alive || !inReach(pk, p)) continue;
      const got = applyPickup(pk, p);
      if (!got) continue;
      pk.availableAt = nowMs + PICKUP_TYPES[pk.type].respawnMs;
      taken.push({ playerId: p.id, i: pk.i, ...got });
      break;
    }
  }
  return taken;
}

// Compact snapshot form: indices of the spots that can be taken right now.
export function availableIndices(pickups, nowMs) {
  const out = [];
  for (const pk of pickups) if (isAvailable(pk, nowMs)) out.push(pk.i);
  return out;
}

// What the client needs once (welcome): where each spot is and what it holds.
export const describePickups = (pickups) => pickups.map(({ i, type, x, y, z }) => ({ i, type, x, y, z }));
