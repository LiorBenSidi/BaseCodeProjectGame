// Weapons table and the per-player weapon state machine (docs/SPEC.md section 20, D-019).
// Pure and deterministic: time comes in as `nowMs`, randomness as an injected `random()`.
// The server is the only place that decides whether a shot happens; the client reads this
// table for the fire interval it uses to pace its own `shoot` intents and for recoil.

import { RIFLE } from './combatData.js';

const W = (o) => Object.freeze({
  ...o,
  bands: Object.freeze(o.bands.map((b) => Object.freeze(b))),
  recoilKick: o.recoilKick ? Object.freeze(o.recoilKick) : undefined,
});

// bands use the combat.js shape { below, damage } so bandDamage/shotDamage apply unchanged.
export const WEAPONS = Object.freeze({
  rifle: W({
    id: 'rifle', name: 'Rifle', slot: 'primary', fireIntervalMs: RIFLE.cooldownMs, range: RIFLE.range,
    magSize: 30, reserve: 90, reloadMs: 2000, switchMs: 400, pellets: 1,
    spreadBase: 0, spreadPerShot: 0.006, spreadDecayPerMs: 0.00005, spreadMax: 0.06,
    recoilPitch: 0.02, recoilYaw: 0.005, bands: RIFLE.bands,
    adsMs: 250, adsSensMul: 0.8, recoilKick: { pitch: 0.02, yaw: 0.005, recoveryMs: 120 },
  }),
  smg: W({
    id: 'smg', name: 'SMG', slot: 'primary', fireIntervalMs: 90, range: 60,
    magSize: 35, reserve: 105, reloadMs: 1600, switchMs: 300, pellets: 1,
    spreadBase: 0.012, spreadPerShot: 0.006, spreadDecayPerMs: 0.00006, spreadMax: 0.08,
    recoilPitch: 0.012, recoilYaw: 0.008, bands: [{ below: 12, damage: 18 }, { below: 25, damage: 14 }, { below: 60, damage: 9 }],
    adsMs: 180, adsSensMul: 0.8, recoilKick: { pitch: 0.012, yaw: 0.008, recoveryMs: 120 },
  }),
  shotgun: W({
    id: 'shotgun', name: 'Shotgun', slot: 'primary', fireIntervalMs: 800, range: 35,
    magSize: 8, reserve: 32, reloadMs: 2500, switchMs: 500, pellets: 8,
    spreadBase: 0.08, spreadPerShot: 0.02, spreadDecayPerMs: 0.00004, spreadMax: 0.12,
    recoilPitch: 0.06, recoilYaw: 0.015, bands: [{ below: 10, damage: 12 }, { below: 20, damage: 7 }, { below: 35, damage: 3 }],
    adsMs: 220, adsSensMul: 0.8, recoilKick: { pitch: 0.06, yaw: 0.015, recoveryMs: 120 },
  }),
  sniper: W({
    id: 'sniper', name: 'Sniper', slot: 'primary', fireIntervalMs: 1200, range: 200,
    magSize: 5, reserve: 20, reloadMs: 3000, switchMs: 600, pellets: 1, scoped: true,
    spreadBase: 0.001, spreadPerShot: 0.05, spreadDecayPerMs: 0.00003, spreadMax: 0.1,
    recoilPitch: 0.08, recoilYaw: 0.002, bands: [{ below: 50, damage: 85 }, { below: 100, damage: 75 }, { below: 200, damage: 65 }],
    adsMs: 320, adsSensMul: 0.65, recoilKick: { pitch: 0.08, yaw: 0.002, recoveryMs: 120 },
  }),
  pistol: W({
    id: 'pistol', name: 'Pistol', slot: 'sidearm', fireIntervalMs: 220, range: 70,
    magSize: 12, reserve: 48, reloadMs: 1400, switchMs: 250, pellets: 1,
    spreadBase: 0.006, spreadPerShot: 0.012, spreadDecayPerMs: 0.00007, spreadMax: 0.05,
    recoilPitch: 0.025, recoilYaw: 0.004, bands: [{ below: 15, damage: 22 }, { below: 30, damage: 16 }, { below: 70, damage: 10 }],
    adsMs: 160, adsSensMul: 0.8, recoilKick: { pitch: 0.025, yaw: 0.004, recoveryMs: 120 },
  }),
});

export const WEAPON_IDS = Object.freeze(Object.keys(WEAPONS));
export const SLOTS = Object.freeze(['primary', 'sidearm']);
export const DEFAULT_LOADOUT = Object.freeze({ primary: 'rifle', sidearm: 'pistol' });

export function weaponDef(id) {
  const d = WEAPONS[id];
  if (!d) throw new RangeError(`unknown weapon: ${id}`);
  return d;
}

export function newWeaponState(id) {
  const d = weaponDef(id);
  return { id, mag: d.magSize, reserve: d.reserve, spread: d.spreadBase, reloadingUntil: -Infinity, lastShotAt: -Infinity };
}

// A player's two slots plus which one is in hand. switchingUntil is shared: you switch the hands, not a gun.
export function newLoadout(ids = DEFAULT_LOADOUT) {
  return { active: 'primary', primary: newWeaponState(ids.primary), sidearm: newWeaponState(ids.sidearm), switchingUntil: -Infinity };
}

export const activeWeapon = (lo) => lo[lo.active];
export const isReloading = (ws, nowMs) => nowMs < ws.reloadingUntil;

// null when the trigger may fire now, otherwise the reason it may not (reported, never guessed).
export function fireBlock(lo, nowMs) {
  const ws = activeWeapon(lo);
  const d = weaponDef(ws.id);
  if (nowMs < lo.switchingUntil) return 'switching';
  if (isReloading(ws, nowMs)) return 'reloading';
  if (ws.mag <= 0) return 'empty';
  if (nowMs - ws.lastShotAt < d.fireIntervalMs) return 'interval';
  return null;
}

export const canFire = (lo, nowMs) => fireBlock(lo, nowMs) === null;

export function recordShot(ws, nowMs) {
  const d = weaponDef(ws.id);
  ws.lastShotAt = nowMs;
  ws.mag -= 1;
  ws.spread = Math.min(d.spreadMax, ws.spread + d.spreadPerShot);
}

export function decaySpread(ws, dtMs) {
  const d = weaponDef(ws.id);
  ws.spread = Math.max(d.spreadBase, ws.spread - d.spreadDecayPerMs * dtMs);
}

// Starts a reload if there is something to load and nothing else is in progress.
export function startReload(lo, nowMs) {
  const ws = activeWeapon(lo);
  const d = weaponDef(ws.id);
  if (nowMs < lo.switchingUntil || isReloading(ws, nowMs)) return false;
  if (ws.mag >= d.magSize || ws.reserve <= 0) return false;
  ws.reloadingUntil = nowMs + d.reloadMs;
  return true;
}

// Called every tick: completes a reload whose timer ran out. Returns true on the tick it completes.
export function finishReloadIfDue(ws, nowMs) {
  if (ws.reloadingUntil === -Infinity || nowMs < ws.reloadingUntil) return false;
  const d = weaponDef(ws.id);
  const take = Math.min(d.magSize - ws.mag, ws.reserve);
  ws.mag += take;
  ws.reserve -= take;
  ws.reloadingUntil = -Infinity;
  return true;
}

// Switching cancels a reload in progress (the rounds stay in the reserve) and costs the new weapon's switchMs.
export function switchSlot(lo, slot, nowMs) {
  if (!SLOTS.includes(slot) || slot === lo.active || nowMs < lo.switchingUntil) return false;
  activeWeapon(lo).reloadingUntil = -Infinity;
  lo.active = slot;
  lo.switchingUntil = nowMs + weaponDef(activeWeapon(lo).id).switchMs;
  return true;
}

// Picks up ammo for the weapon in hand (pickups, SPEC 20.5). Returns the rounds actually added.
export function addReserve(ws, rounds) {
  const d = weaponDef(ws.id);
  const take = Math.max(0, Math.min(rounds, d.reserve * 2 - ws.reserve));
  ws.reserve += take;
  return take;
}

// Perturbs a unit direction by a random offset inside a cone of half-angle `spread` radians.
export function spreadDir(dir, spread, random) {
  if (!(spread > 0)) return dir;
  const theta = 2 * Math.PI * random();
  const rho = spread * Math.sqrt(random());
  const up = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  let rx = dir[1] * up[2] - dir[2] * up[1];
  let ry = dir[2] * up[0] - dir[0] * up[2];
  let rz = dir[0] * up[1] - dir[1] * up[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = dir[1] * rz - dir[2] * ry;
  const uy = dir[2] * rx - dir[0] * rz;
  const uz = dir[0] * ry - dir[1] * rx;
  const a = Math.cos(theta) * Math.tan(rho);
  const b = Math.sin(theta) * Math.tan(rho);
  const ox = dir[0] + rx * a + ux * b;
  const oy = dir[1] + ry * a + uy * b;
  const oz = dir[0] * ry - dir[1] * rx;
  const l = Math.hypot(ox, oy, oz) || 1;
  return [ox / l, oy / l, oz / l];
}
