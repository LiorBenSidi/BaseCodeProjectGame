const SENSITIVITY = 0.0022;
const MAX_PITCH = 1.5533; // keep in sync with server/protocol.js clamp

// Keyboard + mouse state. Aim (yaw/pitch) is accumulated here; movement keys are sampled per command.
export class Input {
  yaw = 0;
  pitch = 0;
  firing = false;
  #keys = new Set();
  #canvas;

  constructor(canvas) {
    this.#canvas = canvas;
    window.addEventListener('keydown', (e) => { if (!e.repeat) this.#keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.#keys.delete(e.code));
    window.addEventListener('blur', () => { this.#keys.clear(); this.firing = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * SENSITIVITY));
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 0 && this.locked) this.firing = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
  }

  get locked() {
    return document.pointerLockElement === this.#canvas;
  }

  has(code) {
    return this.#keys.has(code);
  }

  // Movement intent for one command. Zero while the pointer is not captured (menu, Esc).
  sample() {
    if (!this.locked) return { fwd: 0, right: 0, jump: false };
    const k = (c) => (this.#keys.has(c) ? 1 : 0);
    return {
      fwd: k('KeyW') - k('KeyS'),
      right: k('KeyD') - k('KeyA'),
      jump: this.#keys.has('Space'),
    };
  }
}
