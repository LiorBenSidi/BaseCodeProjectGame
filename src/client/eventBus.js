// Tiny client event bus for decoupling modules (e.g. hit feedback, HUD, audio).
// Pure pub/sub with subscribe, unsubscribe, and emit.

class EventBus {
  #listeners = new Map();

  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.#listeners.get(event);
    if (set) {
      set.delete(fn);
      if (set.size === 0) this.#listeners.delete(event);
    }
  }

  emit(event, payload) {
    const set = this.#listeners.get(event);
    if (set) {
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (err) {
          // Keep emit non-fatal to other subscribers
          if (typeof console !== 'undefined' && console.error) {
            console.error(`[eventBus] listener error on "${event}":`, err);
          }
        }
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}

export const eventBus = new EventBus();
