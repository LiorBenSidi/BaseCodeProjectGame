// First-person weapon view model (SPEC 29.4 & 38.2): a few boxes per weapon parented to the camera, with
// recoil kick, reload dip, ADS pull-in and walk sway. Layout is a pure table; `WeaponView` is Three.js.
import * as THREE from 'three';
import { weaponModel, MATERIALS } from './weaponModels.js';

// SPEC 31.1 & 38.1: the parts come from weaponModels.js (shared with the third person hands); WEAPON_VIEW keeps the
// per weapon hold tweaks (pistols sit closer and higher).
export const WEAPON_VIEW = Object.freeze({
  rifle: { hold: [0, 0, 0] },
  smg: { hold: [0, 0, 0.05] },
  shotgun: { hold: [0, -0.02, -0.05] },
  sniper: { hold: [0, 0, -0.1] },
  pistol: { hold: [-0.04, 0.04, 0.15] },
  burst_rifle: { hold: [0, 0, -0.02] },
  lmg: { hold: [0.02, -0.04, -0.08] },
  revolver: { hold: [-0.03, 0.03, 0.12] },
});
export const INSPECT_MS = 1400; // SPEC 31.1: F turns the weapon over and back
export const REST = Object.freeze({ x: 0.28, y: -0.24, z: -0.5 }); // hip position in camera space
export const ADS_POS = Object.freeze({ x: 0, y: -0.14, z: -0.42 }); // centred under the crosshair
export const KICK = 0.06; // metres back per shot
export const RELOAD_DIP = 0.18;

// Pose for the frame. Pure, so it is testable: ads 0..1, kick 0..1 (decays), reload 0..1 (dip), sway in metres.
export function pose({ ads = 0, kick = 0, reload = 0, swayX = 0, swayY = 0, inspect = 0 } = {}) {
  const x = REST.x + (ADS_POS.x - REST.x) * ads + swayX * (1 - ads);
  const y = REST.y + (ADS_POS.y - REST.y) * ads + swayY * (1 - ads) - RELOAD_DIP * reload;
  const z = REST.z + (ADS_POS.z - REST.z) * ads + KICK * kick;
  // inspect 0..1: lift toward the eye and roll the weapon over, then back
  const ins = Math.sin(inspect * Math.PI);
  return {
    x: x - ins * 0.1, y: y + ins * 0.08, z: z + ins * 0.05,
    pitch: kick * 0.25 - reload * 0.9 + ins * 0.2,
    yaw: ins * 0.9,
    roll: ins * 1.1,
  };
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
  #inspectStart = -Infinity;

  constructor(camera) {
    this.#camera = camera;
  }

  setWeapon(id) {
    if (id === this.#id) return;
    this.#id = id;
    if (this.#group) { this.#camera.remove(this.#group); this.#group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    const view = WEAPON_VIEW[id] ?? WEAPON_VIEW.rifle;
    const model = weaponModel(id);
    const g = new THREE.Group();
    const mats = {
      body: new THREE.MeshStandardMaterial(MATERIALS.body),
      wood: new THREE.MeshStandardMaterial(MATERIALS.wood),
      glass: new THREE.MeshStandardMaterial({ ...MATERIALS.glass, emissive: 0x204060 }),
      accent: new THREE.MeshStandardMaterial({ color: model.accent, roughness: 0.4, metalness: 0.5 }),
    };
    const gun = new THREE.Group();
    for (const [w, h, d, x, y, z, m] of model.parts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[m] ?? mats.body);
      mesh.position.set(x, y, z);
      gun.add(mesh);
    }
    gun.position.set(...view.hold);
    g.add(gun);
    // SPEC 31.1: forearms and gloves so the weapon is held, not floating
    const glove = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.8, metalness: 0.0 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9, metalness: 0.0 });
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), sleeve); rightArm.position.set(0.06, -0.16, 0.26); rightArm.rotation.x = 0.5;
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), glove); rightHand.position.set(0.01, -0.1, 0.05);
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), sleeve); leftArm.position.set(-0.16, -0.18, -0.15); leftArm.rotation.set(0.25, -0.5, 0);
    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), glove); leftHand.position.set(-0.02, -0.06, -0.36 + (model.muzzle + 0.62) * 0.4);
    g.add(rightArm, rightHand, leftArm, leftHand);
    this.#camera.add(g);
    this.#group = g;
  }

  fired() {
    this.#kick = 1;
  }

  // SPEC 31.1: inspect animation; ignored while one is running
  inspect(now = performance.now()) {
    if (now - this.#inspectStart < INSPECT_MS) return;
    this.#inspectStart = now;
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
    const insAge = now - this.#inspectStart;
    const inspect = insAge >= 0 && insAge < INSPECT_MS && this.#ads < 0.5 ? insAge / INSPECT_MS : 0;
    const p = pose({ ads: this.#ads, kick: this.#kick, reload, swayX: Math.sin(this.#t) * sway, swayY: Math.abs(Math.cos(this.#t)) * sway, inspect });
    this.#group.position.set(p.x, p.y, p.z);
    this.#group.rotation.set(p.pitch, p.yaw, p.roll);
  }
}
