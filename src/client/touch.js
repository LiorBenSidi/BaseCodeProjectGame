import { getTouchOverride, resolveDeviceMode } from './deviceMode.js';
import { lookDelta, needsRotate, stickVector } from './touchMath.js';

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  return resolveDeviceMode({
    override: getTouchOverride(),
    hasTouch: (nav.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window,
    coarsePointer: window.matchMedia?.('(pointer: coarse)')?.matches ?? false,
    userAgentMobile: /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? ''),
  }) === 'touch';
}

export class TouchControls {
  #input;
  #actions;
  #root = document.getElementById('touch');
  #knob = document.getElementById('touch-knob');
  #base = document.getElementById('touch-base');
  #move = null; // { id, x, y }
  #look = null; // { id, x, y }

  constructor(input, actions) {
    this.#input = input;
    this.#actions = actions;
    const zone = (id) => document.getElementById(id);
    zone('touch-move')?.addEventListener('pointerdown', (e) => this.#startMove(e));
    zone('touch-look')?.addEventListener('pointerdown', (e) => this.#startLook(e));
    window.addEventListener('pointermove', (e) => this.#onMove(e));
    window.addEventListener('pointerup', (e) => this.#onEnd(e));
    window.addEventListener('pointercancel', (e) => this.#onEnd(e));

    this.#hold('touch-fire', (down) => { input.firing = down; });
    this.#hold('touch-jump', (down) => { input.touch.jump = down; });
    // SPEC 23: sprint is a toggle (tap on, tap off), crouch is a hold; sprint then crouch slides.
    zone('touch-sprint')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.touch.sprint = !input.touch.sprint;
      e.currentTarget.classList.toggle('on', input.touch.sprint);
    });
    this.#hold('touch-crouch', (down) => { input.touch.crouch = down; });
    this.#hold('touch-score', (down) => actions.scoreboard(down));
    zone('touch-nade')?.addEventListener('pointerdown', (e) => { e.preventDefault(); actions.grenade(); });
    zone('touch-melee')?.addEventListener('pointerdown', (e) => { e.preventDefault(); actions.melee?.(); }); // SPEC 38.3
    // SPEC 20: reload and weapon swap as taps
    zone('touch-reload')?.addEventListener('pointerdown', (e) => { e.preventDefault(); actions.reload?.(); });
    zone('touch-swap')?.addEventListener('pointerdown', (e) => { e.preventDefault(); actions.swap?.(); });

    window.addEventListener('resize', () => this.updateRotate());
    this.updateRotate();
  }

  updateRotate() {
    const rotateEl = document.getElementById('rotate');
    if (!rotateEl) return;
    const isTouch = isTouchDevice();
    rotateEl.hidden = !needsRotate(window.innerWidth, window.innerHeight, isTouch);
  }

  // Called from the Play gesture: show controls, go fullscreen and try to lock landscape (not every browser allows it).
  enable() {
    if (!isTouchDevice()) {
      this.disable();
      return;
    }
    if (this.#root) this.#root.hidden = false;
    this.#input.touch.active = true;
    const el = document.documentElement;
    Promise.resolve(el.requestFullscreen?.({ navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
    this.updateRotate();
  }

  disable() {
    if (this.#root) this.#root.hidden = true;
    this.#input.touch.active = false;
    this.#move = null;
    this.#look = null;
    if (this.#base) this.#base.hidden = true;
    this.updateRotate();
  }

  updateMode(inGame = false) {
    if (isTouchDevice() && inGame) {
      this.enable();
    } else {
      this.disable();
    }
  }

  #hold(id, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); });
    const up = () => set(false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  #startMove(e) {
    if (this.#move) return;
    this.#move = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (this.#base) {
      this.#base.style.left = `${e.clientX}px`;
      this.#base.style.top = `${e.clientY}px`;
      this.#base.hidden = false;
    }
    this.#setKnob(0, 0);
  }

  #startLook(e) {
    if (!this.#look) this.#look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  #onMove(e) {
    if (this.#move?.id === e.pointerId) {
      const dx = e.clientX - this.#move.x;
      const dy = e.clientY - this.#move.y;
      const v = stickVector(dx, dy);
      Object.assign(this.#input.touch, v);
      this.#setKnob(v.right, -v.fwd);
    } else if (this.#look?.id === e.pointerId) {
      const d = lookDelta(e.clientX - this.#look.x, e.clientY - this.#look.y);
      this.#input.aimTurn(d.yaw, d.pitch, 'touch'); // SPEC 32.5: touch aim may be assisted
      this.#look.x = e.clientX;
      this.#look.y = e.clientY;
    }
  }

  #onEnd(e) {
    if (this.#move?.id === e.pointerId) {
      this.#move = null;
      Object.assign(this.#input.touch, { fwd: 0, right: 0 });
      if (this.#base) this.#base.hidden = true;
    }
    if (this.#look?.id === e.pointerId) this.#look = null;
  }

  #setKnob(x, y) {
    if (this.#knob) {
      this.#knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
    }
  }
}
