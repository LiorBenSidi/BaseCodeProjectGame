// Controller response (SPEC 36.3, D-033): inner / outer deadzones and selectable response curves, the BO6 and
// Xbox Accessibility Guidelines (XAG 101) standard. Pure functions; input.js applies them to the right stick.
export const CURVES = Object.freeze(['standard', 'linear', 'dynamic']);

// Inner deadzone removes drift, the outer deadzone lets a worn stick still reach full deflection.
export function applyDeadzones(v, inner = 0.15, outer = 0.02) {
  const a = Math.abs(v);
  if (!(a >= inner)) return 0;
  const top = 1 - Math.max(0, Math.min(0.3, outer));
  return Math.sign(v) * Math.min(1, (a - inner) / Math.max(1e-6, top - inner));
}

// standard: power 1.5 (fine centre, fast edge). linear: 1:1. dynamic: an S curve, slow near centre, a
// steep middle, saturating at the edge (smoothstep), the "Dynamic" response in BO6.
export function responseCurve(v, curve = 'standard') {
  const a = Math.min(1, Math.abs(v));
  const s = Math.sign(v);
  if (curve === 'linear') return s * a;
  if (curve === 'dynamic') return s * (a * a * (3 - 2 * a));
  return s * a ** 1.5;
}

export const shapeStick = (v, { inner, outer, curve } = {}) => responseCurve(applyDeadzones(v, inner, outer), curve);
