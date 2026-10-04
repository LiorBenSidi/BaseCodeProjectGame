import { getSensitivity } from './settings.js';
import { bind } from './bindings.js';

const MAX_PITCH = 1.5533; // keep in sync with server/protocol.js clamp
const GAMEPAD_DEADZONE = 0.15;

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

function applyDeadzone(v, dz = GAMEPAD_DEADZONE) {
  if (Math.abs(v) < dz) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - dz) / (1 - dz));
}

// Keyboard + Mouse + Gamepad state.
export class Input {
  yaw = 0;
  pitch = 0;
  firing = false;
  touch = { active: false, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tacSprint: false };
  ads = false; // SPEC 29.3 right mouse held
  chatOpen = false; // SPEC 29.1: while typing, movement keys are ignored
  sensitivity = getSensitivity();
  gamepadSensitivity = 0.03;
  inputType = 'mouse'; // 'mouse' | 'gamepad' | 'touch'
  #keys = new Set();
  #canvas;
  #lastCrouchPress = 0;
  #lastSprintPress = 0;
  #diveTriggered = false;
  #tacSprintTriggered = false;

  constructor(canvas) {
    this.#canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) {
        this.#keys.add(e.code);
        this.inputType = 'mouse';

        const now = performance.now();
        // Double-tap crouch for dive
        if (e.code === bind('crouch') || e.code === bind('crouchAlt')) {
          if (now - this.#lastCrouchPress < 300) {
            this.#diveTriggered = true;
          }
          this.#lastCrouchPress = now;
        }

        // Double-tap sprint for tac sprint
        if (e.code === bind('sprint')) {
          if (now - this.#lastSprintPress < 300) {
            this.#tacSprintTriggered = true;
          }
          this.#lastSprintPress = now;
        }

        // Dedicated keys
        if (e.code === bind('dive')) this.#diveTriggered = true;
        if (e.code === bind('tacSprint')) this.#tacSprintTriggered = true;
      }
    });

    window.addEventListener('keyup', (e) => this.#keys.delete(e.code));
    window.addEventListener('blur', () => { this.#keys.clear(); this.firing = false; this.ads = false; });
    window.addEventListener('mousemove', (e) => {
      this.inputType = 'mouse';
      if (this.locked) this.turn(-e.movementX * this.sensitivity, -e.movementY * this.sensitivity);
    });
    window.addEventListener('mousedown', (e) => {
      this.inputType = 'mouse';
      if (e.button === 0 && this.locked) this.firing = true;
      if (e.button === 2 && this.locked) this.ads = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.ads = false;
    });
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
  }

  get locked() {
    return document.pointerLockElement === this.#canvas;
  }

  get active() {
    return this.locked || this.touch.active || this.#hasActiveGamepad();
  }

  #hasActiveGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    const gps = navigator.getGamepads();
    for (let i = 0; i < gps.length; i++) {
      if (gps[i] && gps[i].connected) return true;
    }
    return false;
  }

  turn(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dpitch));
  }

  has(code) {
    return this.#keys.has(code);
  }

  // Polls connected gamepads for stick/button inputs
  pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const gps = navigator.getGamepads();
    let gp = null;
    for (let i = 0; i < gps.length; i++) {
      if (gps[i] && gps[i].connected) { gp = gps[i]; break; }
    }
    if (!gp) return null;

    // Left stick: move
    const lsX = applyDeadzone(gp.axes[0] ?? 0);
    const lsY = applyDeadzone(gp.axes[1] ?? 0);

    // Right stick: aim
    const rsX = applyDeadzone(gp.axes[2] ?? 0);
    const rsY = applyDeadzone(gp.axes[3] ?? 0);

    if (Math.abs(rsX) > 0 || Math.abs(rsY) > 0) {
      this.inputType = 'gamepad';
      // Quadratic curve for finer control
      const aimX = Math.sign(rsX) * Math.pow(Math.abs(rsX), 1.5) * this.gamepadSensitivity;
      const aimY = Math.sign(rsY) * Math.pow(Math.abs(rsY), 1.5) * this.gamepadSensitivity;
      this.turn(-aimX, -aimY);
    }

    const btn = (i) => gp.buttons[i]?.pressed ?? false;

    // RT/LT
    const rt = (gp.buttons[7]?.value ?? 0) > 0.2 || btn(7);
    const lt = (gp.buttons[6]?.value ?? 0) > 0.2 || btn(6);

    if (rt) this.firing = true;
    this.ads = lt;

    return {
      fwd: -lsY,
      right: lsX,
      jump: btn(0), // A
      crouch: btn(1), // B
      reload: btn(2), // X
      switch: btn(3), // Y
      lb: btn(4),
      rb: btn(5),
      tacSprint: btn(11), // RS click
    };
  }

  // Movement intent for one command.
  sample() {
    if (this.touch.active) this.inputType = 'touch';

    if (!this.active || this.chatOpen) {
      this.#diveTriggered = false;
      this.#tacSprintTriggered = false;
      return { fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tacSprint: false };
    }

    const gp = this.pollGamepad();

    const k = (action) => (this.#keys.has(bind(action)) ? 1 : 0);

    const fwdKey = clamp1(k('fwd') - k('back'));
    const rightKey = clamp1(k('right') - k('left'));

    const gpFwd = gp ? gp.fwd : 0;
    const gpRight = gp ? gp.right : 0;

    const fwd = clamp1(fwdKey + gpFwd + this.touch.fwd);
    const right = clamp1(rightKey + gpRight + this.touch.right);

    const jump = this.#keys.has(bind('jump')) || (gp ? gp.jump : false) || this.touch.jump;
    const sprint = this.#keys.has(bind('sprint')) || !!this.touch.sprint;
    const crouch = this.#keys.has(bind('crouch')) || this.#keys.has(bind('crouchAlt')) || (gp ? gp.crouch : false) || !!this.touch.crouch;

    const dive = this.#diveTriggered || this.touch.dive;
    const tacSprint = this.#tacSprintTriggered || (gp ? gp.tacSprint : false) || this.touch.tacSprint;

    // Reset single-frame triggers
    this.#diveTriggered = false;
    this.#tacSprintTriggered = false;

    return {
      fwd,
      right,
      jump,
      sprint,
      crouch,
      dive,
      tacSprint,
    };
  }
}
