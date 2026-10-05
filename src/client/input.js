import { shapeStick } from './gamepadCurve.js'; // SPEC 36.3
import { getSensitivity } from './settings.js';
import { bind, isBound } from './bindings.js';
import { defaults as prefDefaults } from './prefs.js'; // PRO-menu: SPEC 33 control preferences

const MAX_PITCH = 1.5533; // keep in sync with server/protocol.js clamp
const GAMEPAD_DEADZONE = 0.15;
const DOUBLE_TAP_MS = 300; // SPEC 32.6: two presses inside this window are a double tap

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

// Radial deadzone, re-scaled so the first usable value starts at 0 instead of jumping to the deadzone edge.
export function applyDeadzone(v, dz = GAMEPAD_DEADZONE) {
  if (!(Math.abs(v) >= dz)) return 0;
  return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
}

// SPEC 32.6 stick response: a power curve keeps small deflections fine and the edge fast.
export function stickCurve(v, power = 1.5) {
  return Math.sign(v) * Math.abs(v) ** power;
}

// Keyboard + mouse (+ touch, see touch.js; + gamepad, SPEC 32.6) state. Aim (yaw/pitch) is accumulated here;
// movement is sampled per command. Keys are read through bindings.js so the settings UI can remap them.
export class Input {
  yaw = 0;
  pitch = 0;
  firing = false;
  touch = { active: false, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tac: false };
  ads = false; // SPEC 29.3 right mouse held (or LT)
  chatOpen = false; // SPEC 29.1: while typing, movement keys are ignored
  sensitivity = getSensitivity();
  gamepadSensitivity = 0.045; // radians per frame at full deflection, before the curve
  inputType = 'mouse'; // 'mouse' | 'gamepad' | 'touch': the last device that aimed (aim assist is never for mouse)
  // SPEC 32.5: game.js installs this to bend non-mouse aim toward targets; the raw turn() stays for recoil.
  aimAssist = null;
  #keys = new Set();
  #canvas;
  #mouseFire = false;
  #mouseAds = false;
  #lastCrouchTap = 0;
  #lastSprintTap = 0;
  #dive = false; // one-command pulses, consumed by sample()
  #tac = false;
  #gpPrev = {}; // previous gamepad button state for edge detection
  #gpEdges = []; // actions pressed this frame on the gamepad, consumed by takeGamepadActions()
  // PRO-menu begin (SPEC 33.1): preferences and toggle states
  prefs = prefDefaults();
  #adsToggle = false;
  #crouchToggle = false;
  #sprintToggle = false;
  #mouseEdges = []; // wheel and extra mouse button actions, consumed with the gamepad edges
  // PRO-menu end

  constructor(canvas) {
    this.#canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.#keys.add(e.code);
      const now = performance.now();
      // SPEC 32.6: a double tap on crouch dives, a double tap on sprint starts the tactical sprint
      if (isBound('crouch', e.code)) {
        if (now - this.#lastCrouchTap < DOUBLE_TAP_MS && this.prefs.diveDoubleTap) this.#dive = true;
        this.#lastCrouchTap = now;
      }
      // sprint double tap (tactical sprint) is handled in #onPress with the mouse path
      if (isBound('dive', e.code)) this.#dive = true;
      this.#onPress(e.code, now);
    });
    window.addEventListener('keyup', (e) => { this.#keys.delete(e.code); this.#syncMouseState(); });
    window.addEventListener('blur', () => { this.#keys.clear(); this.#mouseFire = false; this.#mouseAds = false; this.firing = false; this.ads = false; this.#adsToggle = false; this.#crouchToggle = false; this.#sprintToggle = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.inputType = 'mouse';
      if (this.onMouseDelta) { this.onMouseDelta(e.movementX, e.movementY); return; } // SPEC 39.8: the ping wheel borrows the mouse
      this.turn(-e.movementX * this.sensitivity, -e.movementY * this.sensitivity * (this.prefs.invertY ? -1 : 1)); // PRO-menu: invert Y
    });
    // PRO-menu: mouse buttons are keys named Mouse0..Mouse4 so any action can live on the mouse (SPEC 33.2)
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.#keys.add(code);
      const now = performance.now();
      if (isBound('crouch', code)) { if (now - this.#lastCrouchTap < DOUBLE_TAP_MS && this.prefs.diveDoubleTap) this.#dive = true; this.#lastCrouchTap = now; }
      if (isBound('dive', code)) this.#dive = true;
      this.#onPress(code, now);
      // SPEC 38.3: side buttons bound to an edge action (melee, reload, grenade...) share the wheel's edge channel
      for (const a of ['nextWeapon', 'prevWeapon', 'weapon1', 'weapon2', 'reload', 'grenade', 'melee', 'inspect', 'ability1', 'ability2']) if (isBound(a, code)) this.#mouseEdges.push(a);
    });
    window.addEventListener('mouseup', (e) => { this.#keys.delete(`Mouse${e.button}`); this.#syncMouseState(); });
    window.addEventListener('wheel', (e) => {
      if (!this.locked || e.deltaY === 0) return;
      const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
      for (const a of ['nextWeapon', 'prevWeapon', 'weapon1', 'weapon2', 'reload', 'grenade', 'melee', 'jump', 'inspect', 'ability1', 'ability2']) if (isBound(a, code)) this.#mouseEdges.push(a);
      if (isBound('jump', code)) { this.#keys.add(code); setTimeout(() => this.#keys.delete(code), 60); } // a wheel jump is one short press
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); }); // SPEC 29.3: right mouse aims
  }

  get locked() {
    return document.pointerLockElement === this.#canvas;
  }

  // PRO-menu begin (SPEC 33.1)
  #held(action) {
    return this.#keys.has(bind(action)) || this.#keys.has(bind(`${action}Alt`));
  }

  // A fresh press of any code: edge actions (fire / ads toggles, sprint double tap) and the held mouse state.
  #onPress(code, now) {
    if (isBound('ads', code) && this.prefs.adsMode === 'toggle') this.#adsToggle = !this.#adsToggle;
    if (isBound('crouch', code) && this.prefs.crouchMode === 'toggle') this.#crouchToggle = !this.#crouchToggle;
    if (isBound('sprint', code)) {
      if (now - this.#lastSprintTap < DOUBLE_TAP_MS && this.prefs.tacSprintDoubleTap) this.#tac = true;
      this.#lastSprintTap = now;
      if (this.prefs.sprintMode === 'toggle') this.#sprintToggle = !this.#sprintToggle;
    }
    if (isBound('jump', code) && !/^Key|^Space|^Shift|^Control|^Alt/.test(code) && !this.#keys.has(code)) this.#keys.add(code);
    this.#syncMouseState();
  }

  #syncMouseState() {
    this.#mouseFire = this.#held('fire');
    this.#mouseAds = this.prefs.adsMode === 'toggle' ? this.#adsToggle : this.#held('ads');
    this.firing = this.#mouseFire || this.firing && !this.locked; // touch keeps its own firing flag
    if (this.locked) { this.firing = this.#mouseFire; this.ads = this.#mouseAds; }
  }

  // Wheel and mouse button actions since the last call, merged into takeGamepadActions().
  takeMouseActions() {
    if (this.#mouseEdges.length === 0) return [];
    const out = this.#mouseEdges;
    this.#mouseEdges = [];
    return out;
  }
  // PRO-menu end

  // Pointer captured (desktop), touch controls enabled (mobile), or a gamepad connected.
  get active() {
    return this.locked || this.touch.active || this.#gamepad() !== null;
  }

  // Raw camera turn: mouse, recoil, recovery. No assist.
  turn(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dpitch));
  }

  // SPEC 32.5: a turn that came from a stick or a touch drag; the installed aim assist may bend it.
  aimTurn(dyaw, dpitch, type) {
    this.inputType = type;
    if (this.aimAssist && type !== 'mouse') {
      const a = this.aimAssist(dyaw, dpitch, type);
      dyaw = a.dyaw;
      dpitch = a.dpitch;
    }
    this.turn(dyaw, dpitch);
  }

  has(code) {
    return this.#keys.has(code);
  }

  #gamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const gp of navigator.getGamepads()) if (gp && gp.connected) return gp;
    return null;
  }

  // SPEC 32.6 standard mapping: left stick move, right stick aim, RT shoot, LT ADS, A jump, B crouch (double tap
  // dives), X reload, Y switch, LB / RB abilities, right stick click tactical sprint. Called once per command.
  #pollGamepad() {
    const gp = this.#gamepad();
    if (!gp) return null;
    const btn = (i) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
    const shape = { inner: this.prefs.gamepadDeadzone ?? 0.15, outer: this.prefs.gamepadOuterDeadzone ?? 0.02, curve: this.prefs.gamepadCurve ?? 'standard' }; // SPEC 36.3
    const rsX = shapeStick(gp.axes[2] ?? 0, shape);
    const rsY = shapeStick(gp.axes[3] ?? 0, shape);
    if (rsX !== 0 || rsY !== 0) {
      this.aimTurn(-rsX * this.gamepadSensitivity * this.prefs.gamepadSens, -rsY * this.gamepadSensitivity * this.prefs.gamepadSens * (this.prefs.invertY ? -1 : 1), 'gamepad'); // PRO-menu
    }
    const rt = (gp.buttons[7]?.value ?? 0) > 0.2 || btn(7);
    const lt = (gp.buttons[6]?.value ?? 0) > 0.2 || btn(6);
    this.firing = this.#mouseFire || rt;
    this.ads = this.#mouseAds || (this.prefs.adsMode === 'toggle' ? false : lt);
    const now = performance.now();
    const edge = (name, down) => { const was = !!this.#gpPrev[name]; this.#gpPrev[name] = down; return down && !was; };
    if (edge('crouch', btn(1))) {
      if (now - this.#lastCrouchTap < DOUBLE_TAP_MS) this.#dive = true;
      this.#lastCrouchTap = now;
    }
    if (edge('tac', btn(11))) this.#tac = true;
    if (edge('reload', btn(2))) this.#gpEdges.push('reload');
    if (edge('switch', btn(3))) this.#gpEdges.push('switch');
    if (edge('ability1', btn(4))) this.#gpEdges.push('ability1');
    if (edge('ability2', btn(5))) this.#gpEdges.push('ability2');
    if (edge('grenade', btn(9))) this.#gpEdges.push('grenade'); // Start / Menu doubles as grenade on pads without extra buttons
    if (edge('scoreboard', btn(8))) this.#gpEdges.push('scoreboard');
    return {
      fwd: -applyDeadzone(gp.axes[1] ?? 0),
      right: applyDeadzone(gp.axes[0] ?? 0),
      jump: btn(0),
      crouch: btn(1),
    };
  }

  // Gamepad button presses since the last call (reload, switch, ability1, ability2, grenade, scoreboard).
  takeGamepadActions() {
    const mouse = this.takeMouseActions(); // PRO-menu: wheel and extra mouse buttons share the edge channel
    if (this.#gpEdges.length === 0) return mouse;
    const out = this.#gpEdges.concat(mouse);
    this.#gpEdges = [];
    return out;
  }

  // Movement intent for one command. Zero while input is not active (menu, Esc).
  sample() {
    if (this.touch.active) this.inputType = this.inputType === 'gamepad' ? 'gamepad' : 'touch';
    if (!this.active || this.chatOpen) {
      this.#dive = false;
      this.#tac = false;
      return { fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tac: false };
    }
    const gp = this.#pollGamepad();
    const k = (action) => (this.#keys.has(bind(action)) ? 1 : 0);
    const held = (action) => this.#held(action);
    // PRO-menu: toggle and auto modes (SPEC 33.1)
    const fwdK = k('fwd') - k('back');
    const sprintPref = this.prefs.sprintMode === 'toggle' ? this.#sprintToggle && fwdK !== 0 : this.prefs.sprintMode === 'auto' ? fwdK > 0 : held('sprint');
    const crouchPref = this.prefs.crouchMode === 'toggle' ? this.#crouchToggle : held('crouch');
    if (this.prefs.sprintMode === 'toggle' && fwdK === 0 && !held('sprint')) this.#sprintToggle = false;
    const dive = this.#dive || !!this.touch.dive;
    const tac = this.#tac || !!this.touch.tac;
    this.#dive = false;
    this.#tac = false;
    return {
      fwd: clamp1(k('fwd') - k('back') + (gp?.fwd ?? 0) + this.touch.fwd),
      right: clamp1(k('right') - k('left') + (gp?.right ?? 0) + this.touch.right),
      jump: held('jump') || !!gp?.jump || !!this.touch.jump,
      // SPEC 23 / 32: Shift sprints (any direction), C or Ctrl crouches (tap while sprinting to slide)
      sprint: sprintPref || !!this.touch.sprint,
      crouch: crouchPref || !!gp?.crouch || !!this.touch.crouch,
      dive, // SPEC 32.2 one-command pulse
      tac,
    };
  }
}
