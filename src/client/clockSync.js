// Client estimate of the room clock from ping/pong samples (docs/SPEC.md section 18.2).
// Pure: no DOM, no timers, no network. The caller feeds client times (Date.now()) in, sends the
// ping objects it gets back, and routes every `pong` message here. scripts/actor-probe.mjs reuses it.

export const PING_INTERVAL_MS = 1000;
export const PING_TIMEOUT_MS = 5000;
export const CLOCK_SAMPLES = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export class ClockSync {
  #intervalMs;
  #samplesMax;
  #timeoutMs;
  #nextId = 0;
  #lastSentAt = null;
  #outstanding = new Map(); // id -> ts
  #samples = []; // newest last: { rtt, offset }

  constructor({ intervalMs = PING_INTERVAL_MS, samples = CLOCK_SAMPLES, timeoutMs = PING_TIMEOUT_MS } = {}) {
    this.#intervalMs = intervalMs;
    this.#samplesMax = samples;
    this.#timeoutMs = timeoutMs;
  }

  /** The ping to send now, or null when the interval has not passed. Also forgets timed-out pings. */
  nextPing(now) {
    for (const [id, ts] of this.#outstanding) if (now - ts > this.#timeoutMs) this.#outstanding.delete(id);
    if (this.#lastSentAt !== null && now - this.#lastSentAt < this.#intervalMs) return null;
    const id = this.#nextId++;
    this.#lastSentAt = now;
    this.#outstanding.set(id, now);
    return { t: 'ping', id, ts: now };
  }

  /** Records one sample from a pong; returns it, or null when the pong is unknown, stale or malformed. */
  onPong(pong, now) {
    if (!pong || typeof pong !== 'object' || !isNum(pong.now) || !isNum(pong.ts)) return null;
    const sentAt = this.#outstanding.get(pong.id);
    if (sentAt === undefined || sentAt !== pong.ts) return null;
    this.#outstanding.delete(pong.id);
    const rtt = now - sentAt;
    const sample = { rtt, offset: pong.now + rtt / 2 - now };
    this.#samples.push(sample);
    if (this.#samples.length > this.#samplesMax) this.#samples.shift();
    return sample;
  }

  get synced() {
    return this.#samples.length > 0;
  }

  /** Latest round trip in ms, or null. */
  get rtt() {
    return this.synced ? this.#samples[this.#samples.length - 1].rtt : null;
  }

  /** Spread of the kept round trips (max minus min), or null. */
  get jitter() {
    if (!this.synced) return null;
    let lo = Infinity, hi = -Infinity;
    for (const s of this.#samples) { lo = Math.min(lo, s.rtt); hi = Math.max(hi, s.rtt); }
    return hi - lo;
  }

  /** Server minus client time, taken from the lowest-RTT kept sample, or null. */
  get offset() {
    if (!this.synced) return null;
    let best = this.#samples[0];
    for (const s of this.#samples) if (s.rtt < best.rtt) best = s;
    return best.offset;
  }

  /** The room clock for a client time, or null while unsynced. */
  serverTime(now) {
    const offset = this.offset;
    return offset === null ? null : now + offset;
  }

  stats() {
    const rtt = this.rtt;
    return {
      rtt: rtt === null ? null : Math.round(rtt),
      jitter: this.jitter === null ? null : Math.round(this.jitter),
      offset: this.offset,
      samples: this.#samples.length,
    };
  }
}
