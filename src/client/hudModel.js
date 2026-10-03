import { RESPAWN_MS } from '../shared/constants.js';

export function calculateDamageAngle(player, yaw, attacker) {
  const dx = attacker.x - player.x;
  const dz = attacker.z - player.z;
  let angle = Math.atan2(dx, -dz) - yaw;

  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;

  return angle;
}

export class KillFeedQueue {
  #maxSize;
  #expiryMs;
  #entries = [];

  constructor(maxSize = 5, expiryMs = 5000) {
    this.#maxSize = maxSize;
    this.#expiryMs = expiryMs;
  }

  add(text, now = Date.now()) {
    if (!text) return;
    this.#entries.push({ text, time: now });
    if (this.#entries.length > this.#maxSize) {
      this.#entries.splice(0, this.#entries.length - this.#maxSize);
    }
  }

  getEntries(now = Date.now()) {
    this.#entries = this.#entries.filter((entry) => now - entry.time <= this.#expiryMs);
    return [...this.#entries];
  }
}

export function deriveHealthSegments(hp, maxHp = 100, segmentsCount = 5) {
  const percent = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
  const segmentSize = maxHp / segmentsCount;
  const segments = [];

  for (let i = 0; i < segmentsCount; i++) {
    const fill = Math.max(0, Math.min(segmentSize, hp - i * segmentSize));
    segments.push(fill / segmentSize);
  }

  return { percent, segments };
}

export function deriveRespawnText(alive, now, deathTime, respawnMs = RESPAWN_MS) {
  if (alive === 1 || alive === true) {
    return null;
  }

  const dt = deathTime ?? now;
  const remainingMs = Math.max(0, dt + respawnMs - now);
  const sec = (remainingMs / 1000).toFixed(1);

  return {
    visible: true,
    text: `Respawning in ${sec}s...`,
  };
}

export function deriveAmmoStatus() {
  return {
    text: 'INF',
    status: 'READY',
  };
}
