import { lookDelta, needsRotate, stickVector } from './touchMath.js';

// On-screen touch controls (docs/SPEC.md §16, D-016): floating move stick on the left half, drag-to-look on
// the right half, and Fire / Jump / Grenade / Scoreboard buttons. Writes the same intent as keyboard/mouse.
export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

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
    zone('touch-move').addEventListener('pointerdown', (e) => this.#startMove(e));
    zone('touch-look').addEventListener('pointerdown', (e) => this.#startLook(e));
    window.addEventListener('pointermove', (e) => this.#onMove(e));
    window.addEventListener('pointerup', (e) => this.#onEnd(e));
    window.addEventListener('pointercancel', (e) => this.#onEnd(e));

    this.#hold('touch-fire', (down) => { input.firing = down; });
    this.#hold('touch-jump', (down) => { input.touch.jump = down; });
    this.#hold('touch-score', (down) => actions.scoreboard(down));
    zone('touch-nade').addEventListener('pointerdown', (e) => { e.preventDefault(); actions.grenade(); });

    const updateRotate = () => {
      document.getElementById('rotate').hidden = !needsRotate(innerWidth, innerHeight, isTouchDevice());
    };
    window.addEventListener('resize', updateRotate);
    updateRotate();
  }

  // Called from the Play gesture: show controls, go fullscreen and try to lock landscape (not every browser allows it).
  enable() {
    this.#root.hidden = false;
    this.#input.touch.active = true;
    const el = document.documentElement;
    Promise.resolve(el.requestFullscreen?.({ navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }

  #hold(id, set) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); });
    const up = () => set(false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  #startMove(e) {
    if (this.#move) return;
    this.#move = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.#base.style.left = `${e.clientX}px`;
    this.#base.style.top = `${e.clientY}px`;
    this.#base.hidden = false;
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
      this.#input.turn(d.yaw, d.pitch);
      this.#look.x = e.clientX;
      this.#look.y = e.clientY;
    }
  }

  #onEnd(e) {
    if (this.#move?.id === e.pointerId) {
      this.#move = null;
      Object.assign(this.#input.touch, { fwd: 0, right: 0 });
      this.#base.hidden = true;
    }
    if (this.#look?.id === e.pointerId) this.#look = null;
  }

  #setKnob(x, y) {
    this.#knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
  }
}
