// Articulated player figure (SPEC 31.2). Pure: joint dimensions and the walk / idle cycle in angles, so remote.js
// only applies numbers. The silhouette is deliberately simple and high contrast: readability over detail.
export const RIG = Object.freeze({
  torso: [0.62, 0.62, 0.36, 0, 1.05, 0], // [w, h, d, x, y, z], y is the centre
  pelvis: [0.5, 0.2, 0.32, 0, 0.78, 0],
  head: [0.36, 0.36, 0.36, 0, 1.6, 0],
  visor: [0.3, 0.09, 0.05, 0, 1.63, -0.19],
  upperArm: [0.16, 0.42, 0.16], // pivot at the shoulder, hangs down
  shoulderY: 1.3,
  shoulderX: 0.4,
  leg: [0.2, 0.7, 0.22], // pivot at the hip, hangs down
  hipY: 0.7,
  hipX: 0.14,
  weaponHold: { x: 0.18, y: 1.15, z: -0.3 }, // weapon origin in body space, both hands on it
});

// Angles in radians for the frame. speed m/s on the ground, phase advances with distance travelled.
export function walkCycle(phase, speed, { airborne = false, crouchK = 1 } = {}) {
  const k = Math.min(1, speed / 5.6);
  if (airborne) return { legL: 0.5, legR: -0.35, armSwing: -0.4, bob: 0.0, lean: 0.08 };
  const s = Math.sin(phase);
  const legA = 0.75 * k * (crouchK < 0.9 ? 0.6 : 1);
  return {
    legL: s * legA,
    legR: -s * legA,
    armSwing: -s * 0.35 * k, // arms counter the legs; the weapon hand damps it
    bob: Math.abs(Math.cos(phase)) * 0.04 * k,
    lean: 0.05 + 0.12 * Math.max(0, (speed - 5.6) / 3), // sprint leans forward
  };
}

// Phase advance for a frame: one full cycle per 1.6 m of travel at any speed (so legs match the ground).
export function advancePhase(phase, speed, dt) {
  return (phase + (speed * dt * 2 * Math.PI) / 1.6) % (2 * Math.PI);
}

// Hit flash curve: 1 at the hit, 0 after `ms`; stacked hits restart it.
export function hitFlash(sinceMs, ms = 120) {
  if (sinceMs < 0 || sinceMs >= ms) return 0;
  return 1 - sinceMs / ms;
}

// Death pose (SPEC 31.3): the figure tips over `ms` after dying; returns the body roll and sink.
export function deathPose(sinceMs, ms = 450) {
  const t = Math.min(1, Math.max(0, sinceMs / ms));
  const e = 1 - (1 - t) * (1 - t);
  return { roll: e * (Math.PI / 2) * 0.92, sink: e * 0.35, fade: t > 0.7 ? Math.min(1, (t - 0.7) / 0.3) : 0 };
}
