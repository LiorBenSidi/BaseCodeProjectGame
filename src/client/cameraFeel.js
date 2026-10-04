// Pure camera feel math unit-tested curves for CoD BO6 feel (SPEC 32).
// Handles landing dip, subtle head bob, sprint FOV kick, slide camera tilt, dive lowering, mantle dip.

export function calculateLandingDip(fallSpeed) {
  if (fallSpeed >= 0) return 0;
  const absSpeed = Math.abs(fallSpeed);
  if (absSpeed < 1.0) return 0;
  return Math.min(0.25, (absSpeed - 1.0) * 0.02);
}

export function calculateHeadBob(speed, baseSpeed = 5.6, isAds = false, timeSec = 0) {
  if (isAds || speed < 0.1) return { x: 0, y: 0 };
  const factor = Math.min(1.5, speed / baseSpeed);
  const freq = 10;
  const x = Math.cos(timeSec * freq * 0.5) * 0.012 * factor;
  const y = Math.sin(timeSec * freq) * 0.02 * factor;
  return { x, y };
}

export function calculateFovOffset(isSprinting, isTacSprinting) {
  if (isTacSprinting) return 8;
  if (isSprinting) return 5;
  return 0;
}

export function calculateSlideTilt(isSliding) {
  if (!isSliding) return 0;
  // 3 degrees in radians (~0.0523598 rad)
  return (3 * Math.PI) / 180;
}

export function calculateDiveOffset(isDiving) {
  if (!isDiving) return 0;
  return -0.25;
}

export function calculateMantleDip(mantleTimeLeft, mantleTotalDuration = 0.15) {
  if (mantleTimeLeft <= 0) return 0;
  const progress = mantleTimeLeft / mantleTotalDuration;
  return -Math.sin(progress * Math.PI) * 0.15;
}

export class CameraFeel {
  #landingDip = 0;
  #mantleTimer = 0;
  #time = 0;

  get landingDip() { return this.#landingDip; }
  get mantleTimer() { return this.#mantleTimer; }

  onLanding(fallSpeed) {
    this.#landingDip = calculateLandingDip(fallSpeed);
  }

  onMantle() {
    this.#mantleTimer = 0.15;
  }

  step(dt, state = {}) {
    const {
      speed = 0,
      baseSpeed = 5.6,
      isAds = false,
      isSprinting = false,
      isTacSprinting = false,
      isSliding = false,
      isDiving = false,
    } = state;

    this.#time += dt;

    if (this.#landingDip > 0) {
      this.#landingDip = Math.max(0, this.#landingDip - dt * 1.5);
    }

    if (this.#mantleTimer > 0) {
      this.#mantleTimer = Math.max(0, this.#mantleTimer - dt);
    }

    const bob = calculateHeadBob(speed, baseSpeed, isAds, this.#time);
    const fovKick = calculateFovOffset(isSprinting, isTacSprinting);
    const rollTilt = calculateSlideTilt(isSliding);
    const diveOffset = calculateDiveOffset(isDiving);
    const mantleDip = calculateMantleDip(this.#mantleTimer);

    const offsetY = -this.#landingDip + bob.y + diveOffset + mantleDip;
    const offsetX = bob.x;

    return { offsetX, offsetY, rollTilt, fovKick };
  }
}
