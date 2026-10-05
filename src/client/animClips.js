// First person arm and weapon clips (docs/SPEC.md section 38.2, D-037). Pure math, no Three.js, so every clip is
// testable: each clip maps a phase 0..1 to offsets in camera space (metres and radians) plus arm hints. The view
// model composes the clips additively on top of the hip or ADS pose, and the third person rig (remote.js) reads the
// same phases from the snapshot so what others see matches what the player feels.
import { meleeStyle } from '../shared/weapons.js';

export const CLIP_MS = Object.freeze({
  draw: 380, // weapon comes up from below the frame (matches switchMs order of magnitude; the view clamps to the weapon's switchMs)
  inspect: 1400,
  clash: 600,
});

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const bump = (t) => Math.sin(clamp01(t) * Math.PI); // 0 -> 1 -> 0

// Idle breathing: a slow lift and roll that never stops, so the arms read as alive even when still.
export function idleClip(tSeconds) {
  return { y: Math.sin(tSeconds * 1.6) * 0.004, roll: Math.sin(tSeconds * 1.1) * 0.006, pitch: 0, x: 0, z: 0, yaw: 0 };
}

// Walk and sprint bob: a figure eight scaled by speed; sprinting lowers the weapon and widens the swing.
export function bobClip(tPhase, speedNorm, sprinting) {
  const amp = speedNorm * (sprinting ? 0.022 : 0.012);
  return {
    x: Math.sin(tPhase) * amp,
    y: Math.abs(Math.cos(tPhase)) * amp - (sprinting ? 0.05 * speedNorm : 0),
    z: sprinting ? 0.04 * speedNorm : 0,
    pitch: sprinting ? 0.18 * speedNorm : 0,
    yaw: sprinting ? -0.35 * speedNorm : 0,
    roll: Math.sin(tPhase) * amp * 1.5,
  };
}

// Draw: the weapon rises from below and rolls into the hands. phase 0 at the switch, 1 when settled.
export function drawClip(phase) {
  const k = 1 - smooth(clamp01(phase));
  return { x: 0.04 * k, y: -0.35 * k, z: 0.08 * k, pitch: -0.9 * k, yaw: 0.25 * k, roll: 0.3 * k };
}

// Reload: dip, tilt the weapon toward the eye so the magazine is seen, left hand drops to the hip, then back.
export function reloadClip(phase) {
  const p = clamp01(phase);
  const dip = bump(p);
  const magOut = bump(clamp01((p - 0.1) / 0.45)); // first half: magazine comes out
  const magIn = bump(clamp01((p - 0.5) / 0.4)); // second half: slaps back in
  return {
    x: -0.03 * dip, y: -0.16 * dip, z: 0.02 * dip,
    pitch: -0.75 * dip, yaw: 0.35 * dip, roll: -0.25 * dip,
    leftHand: { drop: 0.22 * magOut + 0.08 * magIn, forward: -0.1 * magOut }, // metres
  };
}

// Inspect: lift toward the eye and turn the weapon over, then back.
export function inspectClip(phase) {
  const ins = bump(clamp01(phase));
  return { x: -0.1 * ins, y: 0.08 * ins, z: 0.05 * ins, pitch: 0.2 * ins, yaw: 0.9 * ins, roll: 1.1 * ins };
}

// Fire: a kick back and up that the view decays itself (kick 0..1).
export function fireClip(kick) {
  return { x: 0, y: 0.01 * kick, z: 0.06 * kick, pitch: 0.25 * kick, yaw: 0, roll: 0.03 * kick };
}

// Melee swing for a kit style: the whole arm group pulls back during the windup, slashes across the frame during the
// active window and settles during the recovery. Returns the offsets plus the blade angle for the third person rig.
export function meleeClip(styleId, elapsedMs) {
  const st = meleeStyle(styleId);
  const total = st.windupMs + st.activeMs + st.recoveryMs;
  if (elapsedMs < 0 || elapsedMs >= total) return null;
  let phase;
  let swing; // -1 pulled back, +1 fully across
  if (elapsedMs < st.windupMs) { phase = 'windup'; swing = -smooth(elapsedMs / st.windupMs); }
  else if (elapsedMs < st.windupMs + st.activeMs) { phase = 'active'; swing = -1 + 2 * smooth((elapsedMs - st.windupMs) / st.activeMs); }
  else { phase = 'recovery'; swing = 1 - smooth((elapsedMs - st.windupMs - st.activeMs) / st.recoveryMs); }
  const dual = st.id === 'medic'; // two knives: a shorter arc with both hands
  const arc = dual ? 0.9 : 1.3;
  return {
    phase, swing,
    x: -0.22 * swing * (dual ? 0.6 : 1), y: 0.06 * Math.abs(swing) - 0.04 * swing, z: 0.12 * Math.abs(swing) - 0.18 * Math.max(0, swing),
    pitch: -0.2 * swing, yaw: arc * swing, roll: 0.5 * swing,
    bladeAngle: arc * swing, // radians around the vertical axis, for remote.js
  };
}

// Clash: a hard knock back and a short shake, longer for the staggered player than for the riposte.
export function clashClip(elapsedMs, riposte) {
  const ms = riposte ? CLIP_MS.clash * 0.45 : CLIP_MS.clash;
  if (elapsedMs < 0 || elapsedMs >= ms) return null;
  const p = elapsedMs / ms;
  const k = 1 - p;
  const shake = Math.sin(elapsedMs * 0.09) * k * k;
  return { x: 0.05 * shake, y: 0.04 * k, z: 0.16 * k, pitch: 0.45 * k, yaw: -0.3 * k + 0.1 * shake, roll: 0.3 * shake };
}

const ZERO = Object.freeze({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 });

// Adds any number of clips (null and missing fields are fine). Extra fields (leftHand, phase, swing) ride along from the last clip that has them.
export function compose(...clips) {
  const out = { ...ZERO };
  for (const c of clips) {
    if (!c) continue;
    for (const k of Object.keys(ZERO)) out[k] += c[k] ?? 0;
    for (const k of Object.keys(c)) if (!(k in ZERO)) out[k] = c[k];
  }
  return out;
}

// Third person: the arm pitch and the blade angle to show for a snapshot melee phase (ml) and the time since it was first seen.
export function thirdPersonMelee(styleId, phaseCode, sinceMs) {
  if (!phaseCode) return null;
  if (phaseCode === 4) return { armPitch: -0.6, bladeAngle: 0, shake: Math.max(0, 1 - sinceMs / CLIP_MS.clash) };
  const st = meleeStyle(styleId);
  // map the snapshot phase onto the clip: windup starts at 0, active at windupMs, recovery after
  const base = phaseCode === 1 ? 0 : phaseCode === 2 ? st.windupMs : st.windupMs + st.activeMs;
  const c = meleeClip(styleId, Math.min(base + sinceMs, st.windupMs + st.activeMs + st.recoveryMs - 1));
  return c ? { armPitch: -1.2 - 0.4 * c.swing, bladeAngle: c.bladeAngle, shake: 0 } : null;
}
