// First-person weapon view model (SPEC 29.4): a few boxes per weapon parented to the camera, with
// recoil kick, reload dip, ADS pull-in and walk sway. Layout is a pure table; `WeaponView` is Three.js.
import * as THREE from 'three';

// Parts: [w, h, d, x, y, z] in camera space (camera looks down -Z; right-handed hold at bottom right).
export const WEAPON_VIEW = Object.freeze({
  rifle: { color: 0x3b4252, parts: [[0.08, 0.1, 0.7, 0, 0, -0.1], [0.06, 0.14, 0.18, 0, -0.1, 0.1], [0.03, 0.03, 0.4, 0, 0.05, -0.45]] },
  smg: { color: 0x2e3440, parts: [[0.08, 0.1, 0.45, 0, 0, -0.05], [0.05, 0.16, 0.1, 0, -0.12, 0.05], [0.05, 0.2, 0.06, 0, -0.14, -0.1]] },
  shotgun: { color: 0x5a3b2e, parts: [[0.09, 0.1, 0.85, 0, 0, -0.15], [0.08, 0.14, 0.2, 0, -0.08, 0.15], [0.04, 0.04, 0.5, 0, -0.06, -0.4]] },
  sniper: { color: 0x1f2a24, parts: [[0.07, 0.09, 1.0, 0, 0, -0.2], [0.05, 0.14, 0.2, 0, -0.1, 0.15], [0.05, 0.05, 0.3, 0, 0.09, -0.15]] },
  pistol: { color: 0x2b2b2b, parts: [[0.05, 0.07, 0.25, 0, 0, 0], [0.04, 0.14, 0.07, 0, -0.1, 0.08]] },
});
export const REST = Object.freeze({ x: 0.28, y: -0.24, z: -0.5 }); // hip position in camera space
export const ADS_POS = Object.freeze({ x: 0, y: -0.14, z: -0.42 }); // centred under the crosshair
export const KICK = 0.06; // metres back per shot
export const RELOAD_DIP = 0.18;

// Pose for the frame. Pure, so it is testable: ads 0..1, kick 0..1 (decays), reload 0..1 (dip), sway in metres.
export function pose({ ads = 0, kick = 0, reload = 0, swayX = 0, swayY = 0 } = {}) {
  const x = REST.x + (ADS_POS.x - REST.x) * ads + swayX * (1 - ads);
  const y = REST.y + (ADS_POS.y - REST.y) * ads + swayY * (1 - ads) - RELOAD_DIP * reload;
  const z = REST.z + (ADS_POS.z - REST.z) * ads + KICK * kick;
  return { x, y, z, pitch: kick * 0.25 - reload * 0.9 };
}

export class WeaponView {
  #camera;
  #group = null;
  #id = null;
  #kick = 0;
  #ads = 0;
  #reloadUntil = 0;
  #reloadMs = 1;
  #t = 0;

  constructor(camera) {
    this.#camera = camera;
  }

  setWeapon(id) {
    if (id === this.#id) return;
    this.#id = id;
    if (this.#group) { this.#camera.remove(this.#group); this.#group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    const def = WEAPON_VIEW[id] ?? WEAPON_VIEW.rifle;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.55, metalness: 0.4 });
    for (const [w, h, d, x, y, z] of def.parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
    }
    this.#camera.add(g);
    this.#group = g;
  }

  fired() {
    this.#kick = 1;
  }

  reloading(ms, now) {
    this.#reloadMs = Math.max(1, ms);
    this.#reloadUntil = now + ms;
  }

  setVisible(on) {
    if (this.#group) this.#group.visible = on;
  }

  // dt seconds; moving: horizontal speed in m/s; ads: target 0/1
  update(dt, now, { moving = 0, ads = false } = {}) {
    if (!this.#group) return;
    this.#kick = Math.max(0, this.#kick - dt * 9);
    this.#ads += ((ads ? 1 : 0) - this.#ads) * Math.min(1, dt * 14);
    this.#t += dt * (1 + Math.min(1, moving / 6) * 7);
    const sway = Math.min(1, moving / 6) * 0.012;
    const remaining = this.#reloadUntil - now;
    const reload = remaining > 0 ? Math.sin((1 - remaining / this.#reloadMs) * Math.PI) : 0;
    const p = pose({ ads: this.#ads, kick: this.#kick, reload, swayX: Math.sin(this.#t) * sway, swayY: Math.abs(Math.cos(this.#t)) * sway });
    this.#group.position.set(p.x, p.y, p.z);
    this.#group.rotation.set(p.pitch, 0, 0);
  }
}
