// Pure audio math (SPEC 35.1, D-032): panning, distance, cue variants, bus mixing. audio.js applies it to WebAudio.

// Stereo pan (-1 left .. 1 right) of a source at (sx, sz) heard by a listener at (lx, lz) looking along yaw
// (yaw 0 looks toward -Z, as in movement.js). Sources straight ahead or behind pan to 0; dead left pans to -1.
// SPEC 37.6: source position in the listener's own frame for a PannerNode in HRTF mode. Web Audio's default
// listener faces -Z with +X to the right, so a source straight ahead lands at negative z and panning needs no
// listener orientation updates. Only the horizontal plane is tracked (the listener's ear height is the origin).
export function hrtfLocalPosition(listener, source) {
  const dx = source[0] - listener.x, dz = source[2] - listener.z;
  const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw); // right
  const fx = -Math.sin(listener.yaw), fz = -Math.cos(listener.yaw); // forward
  const x = dx * rx + dz * rz;
  const ahead = dx * fx + dz * fz;
  return [x, source[1] ?? 0, -ahead];
}

export const SPATIAL_MODES = Object.freeze(['stereo', 'hrtf']);

export function panFor(listener, source) {
  const dx = source[0] - listener.x, dz = source[2] - listener.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return 0;
  // right vector for yaw: (cos yaw, 0, -sin yaw)
  const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
  const pan = (dx * rx + dz * rz) / d;
  return Math.max(-1, Math.min(1, pan * 0.85)); // never fully one sided: a hard pan sounds broken on headphones
}

// Distance attenuation: full inside 4 m, fading to 0 at `maxM`.
export const falloff = (d, maxM = 60) => (!(d >= 0) ? 1 : d <= 4 ? 1 : Math.max(0, 1 - (d - 4) / (maxM - 4)));

// Shots heard from far away lose their crack and keep their thump: the distant variant has a lowpass and a tail.
export const DISTANT_M = 30;
export const isDistant = (d) => d >= DISTANT_M;

// Busses. The master scales everything; sfx covers the world, ui covers menu and HUD sounds.
export const BUSES = Object.freeze(['master', 'sfx', 'ui']);
export const DEFAULT_LEVELS = Object.freeze({ master: 1, sfx: 1, ui: 0.8 });
export const clampLevel = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
export const busGain = (levels, bus) => clampLevel(levels.master) * clampLevel(levels[bus] ?? 1);

// Lowpass cutoff for a source heard `d` metres away: 18 kHz close, down to 900 Hz at 60 m.
export const cutoffFor = (d) => Math.max(900, 18000 - Math.max(0, d - 4) * 300);

// Ducking: while a loud cue plays (own shot, explosion) the rest of the sfx bus dips and recovers.
export const DUCK = Object.freeze({ gain: 0.55, attackS: 0.005, releaseS: 0.18 });
