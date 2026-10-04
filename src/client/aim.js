// Aim-down-sights and field of view (SPEC 29.3, SPEC 32). Pure: camera and settings panel consume this.
import { WEAPONS } from '../shared/weapons.js';

export const DEFAULT_FOV = 80;
export const MIN_FOV = 60;
export const MAX_FOV = 110;
export const ADS_LERP = 18; // base per second lerp rate

// Zoomed fov per weapon: the sniper scopes hard, everything else tightens a little.
export const ADS_FOV = Object.freeze({ sniper: 28, rifle: 58, smg: 62, shotgun: 68, pistol: 64 });

export const clampFov = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return DEFAULT_FOV;
  return Math.max(MIN_FOV, Math.min(MAX_FOV, Math.round(n)));
};

// Target fov for the frame: ADS pulls toward the weapon's zoom, else the player's setting.
export function targetFov(baseFov, weaponId, ads) {
  if (!ads) return baseFov;
  const z = ADS_FOV[weaponId] ?? ADS_FOV.rifle;
  return Math.min(baseFov, z);
}

// Mouse sensitivity scale while zoomed, so the same wrist travel covers the same screen fraction.
export function sensitivityScale(fov, baseFov, weaponId) {
  const zoomScale = Math.tan((fov * Math.PI) / 360) / Math.tan((baseFov * Math.PI) / 360);
  const w = WEAPONS[weaponId];
  const adsSensMul = w?.adsSensMul ?? 0.8;
  return zoomScale * adsSensMul;
}

export const isScoped = (weaponId, ads) => ads && WEAPONS[weaponId]?.id === 'sniper';

export function stepFov(fov, target, dt, weaponId = 'rifle') {
  const w = WEAPONS[weaponId];
  const adsMs = w?.adsMs ?? 250;
  const lerpRate = (1000 / adsMs) * 2;
  return fov + (target - fov) * Math.min(1, dt * lerpRate);
}
