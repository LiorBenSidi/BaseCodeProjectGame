// Aim-down-sights and field of view (SPEC 29.3, timing and sensitivity from SPEC 32.4). Pure: the camera and the
// settings panel consume this.
import { WEAPONS } from '../shared/weapons.js';

export const DEFAULT_FOV = 80;
export const MIN_FOV = 60;
export const MAX_FOV = 110;
export const ADS_LERP = 18; // per second, toward the target fov

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
export const sensitivityScale = (fov, baseFov) => Math.tan((fov * Math.PI) / 360) / Math.tan((baseFov * Math.PI) / 360);

// SPEC 32.4: on top of the zoom scale, each weapon has an ADS sensitivity multiplier (0.8 by default, the sniper
// lower) so a zoomed wrist is a little slower than the geometric scale alone, like the genre reference.
export function adsSensitivity(fov, baseFov, weaponId, ads) {
  const scale = sensitivityScale(fov, baseFov);
  if (!ads) return scale;
  return scale * (WEAPONS[weaponId]?.adsSensMul ?? 0.8);
}

export const isScoped = (weaponId, ads) => ads && WEAPONS[weaponId]?.id === 'sniper';

export const stepFov = (fov, target, dt) => fov + (target - fov) * Math.min(1, dt * ADS_LERP);

// SPEC 32.4: per-weapon ADS time. The lerp rate is 3 / adsMs, so the fov is within 5% of the target after adsMs
// (e^-3), which is what the eye reads as "the sight is up". Unknown weapons use the rifle timing.
export function adsLerpRate(weaponId) {
  const ms = WEAPONS[weaponId]?.adsMs ?? WEAPONS.rifle.adsMs;
  return 3000 / ms;
}
export const stepFovFor = (fov, target, dt, weaponId) => fov + (target - fov) * Math.min(1, dt * adsLerpRate(weaponId));
