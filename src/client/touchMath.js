// Pure touch-control math (docs/SPEC.md §16.1, D-016). No DOM here so it can be unit-tested.

export const STICK_RADIUS = 60;
export const STICK_DEADZONE = 0.15;
export const LOOK_SENSITIVITY = 0.005;

// Thumb offset from the stick origin (screen px, down is +y) -> movement intent.
export function stickVector(dx, dy, radius = STICK_RADIUS, deadzone = STICK_DEADZONE) {
  let x = dx / radius;
  let y = dy / radius;
  const len = Math.hypot(x, y);
  if (len < deadzone) return { fwd: 0, right: 0 };
  if (len > 1) { x /= len; y /= len; }
  return { fwd: 0 - y, right: x + 0 };
}

export function lookDelta(dx, dy, sensitivity = LOOK_SENSITIVITY) {
  return { yaw: -dx * sensitivity, pitch: -dy * sensitivity };
}

export function needsRotate(width, height, coarse) {
  return coarse && height > width;
}
