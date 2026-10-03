// Token bucket: allows short bursts up to `capacity`, sustained rate of `refillPerSec`.
// The clock is injected so tests never sleep.

export class TokenBucket {
  #capacity;
  #refillPerMs;
  #now;
  #tokens;
  #last;

  constructor({ capacity, refillPerSec, now = () => Date.now() } = {}) {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!ok(capacity) || !ok(refillPerSec)) {
      throw new RangeError('capacity and refillPerSec must be positive, finite numbers');
    }
    this.#capacity = capacity;
    this.#refillPerMs = refillPerSec / 1000;
    this.#now = now;
    this.#tokens = capacity;
    this.#last = now();
  }

  take(cost = 1) {
    const t = this.#now();
    const elapsed = Math.max(0, t - this.#last); // tolerate a clock that steps backwards
    this.#last = t;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerMs);
    if (this.#tokens < cost) return false;
    this.#tokens -= cost;
    return true;
  }
}
