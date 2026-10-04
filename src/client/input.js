import { getSensitivity } from './settings.js';

const MAX_PITCH = 1.5533; // keep in sync with server/protocol.js clamp

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

// Keyboard + mouse (+ touch, see touch.js) state. Aim (yaw/pitch) is accumulated here; movement is sampled per command.
export class Input {
  yaw = 0;
  pitch = 0;
  firing = false;
  touch = { active: false, fwd: 0, right: 0, jump: false, sprint: false, crouch: false };
  sensitivity = getSensitivity();
  #keys = new Set();
  #canvas;

  constructor(canvas) {
    this.#canvas = canvas;
    window.addEventListener('keydown', (e) => { if (!e.repeat) this.#keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.#keys.delete(e.code));
    window.addEventListener('blur', () => { this.#keys.clear(); this.firing = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) this.turn(-e.movementX * this.sensitivity, -e.movementY * this.sensitivity);
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 0 && this.locked) this.firing = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
  }

  get locked() {
    return document.pointerLockElement === this.#canvas;
  }

  // Pointer captured (desktop) or touch controls enabled (mobile).
  get active() {
    return this.locked || this.touch.active;
  }

  turn(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dpitch));
  }

  has(code) {
    return this.#keys.has(code);
  }

  // Movement intent for one command. Zero while input is not active (menu, Esc).
  sample() {
    if (!this.active) return { fwd: 0, right: 0, jump: false, sprint: false, crouch: false };
    const k = (c) => (this.#keys.has(c) ? 1 : 0);
    return {
      fwd: clamp1(k('KeyW') - k('KeyS') + this.touch.fwd),
      right: clamp1(k('KeyD') - k('KeyA') + this.touch.right),
      jump: this.#keys.has('Space') || this.touch.jump,
      // SPEC 23: Shift sprints, C or Ctrl crouches (tap while sprinting to slide); touch has its own buttons
      sprint: this.#keys.has('ShiftLeft') || this.#keys.has('ShiftRight') || !!this.touch.sprint,
      crouch: this.#keys.has('KeyC') || this.#keys.has('ControlLeft') || !!this.touch.crouch,
    };
  }
}
