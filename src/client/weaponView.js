// First-person weapon view model (SPEC 29.4 & 38.2): a few boxes per weapon parented to the camera, held by two
// procedural arms. The clips (draw, idle, bob, reload, inspect, fire, melee, clash) live in animClips.js as pure math;
// `pose()` below is the base hip / ADS pose the clips add onto. `WeaponView` is the only Three.js part.
import * as THREE from 'three';
import { weaponModel, MATERIALS } from './weaponModels.js';
import { idleClip, bobClip, drawClip, reloadClip, inspectClip, fireClip, meleeClip, clashClip, compose, CLIP_MS } from './animClips.js'; // SPEC 38.2
import { meleeStyle } from '../shared/weapons.js';

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
  #arms = null; // { leftHand, leftArm, blade }
  #id = null;
  #kick = 0;
  #ads = 0;
  #reloadUntil = 0;
  #reloadMs = 1;
  #t = 0;
  #idleT = 0;
  #inspectStart = -Infinity;
  #drawStart = -Infinity;
  #drawMs = CLIP_MS.draw;
  #swingStart = -Infinity;
  #swingStyle = 'vanguard';
  #clashStart = -Infinity;
  #clashRiposte = false;

  constructor(camera) {
    this.#camera = camera;
  }

  setWeapon(id, now = performance.now()) {
    if (id === this.#id) return;
    const first = this.#id === null;
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
    // SPEC 31.1 / 38.2: forearms and gloves so the weapon is held, not floating; the left hand moves in the reload clip
    const glove = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.8, metalness: 0.0 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9, metalness: 0.0 });
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), sleeve); rightArm.position.set(0.06, -0.16, 0.26); rightArm.rotation.x = 0.5;
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), glove); rightHand.position.set(0.01, -0.1, 0.05);
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), sleeve); leftArm.position.set(-0.16, -0.18, -0.15); leftArm.rotation.set(0.25, -0.5, 0);
    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), glove); leftHand.position.set(-0.02, -0.06, -0.36 + (model.muzzle + 0.62) * 0.4);
    // SPEC 38.3: the kit blade, hidden until a swing; a flat slab with the kit accent
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.42), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.25, metalness: 0.9, emissive: 0x223344 }));
    blade.position.set(0.02, -0.08, -0.2);
    blade.visible = false;
    g.add(rightArm, rightHand, leftArm, leftHand, blade);
    this.#arms = { leftHand, leftArm, blade, leftHandRest: leftHand.position.clone(), leftArmRest: leftArm.position.clone() };
    this.#camera.add(g);
    this.#group = g;
    if (!first) { this.#drawStart = now; } // SPEC 38.2: the draw clip plays on every switch, not on the first frame
  }

  // SPEC 38.2: the switch time of the weapon in hand (so the draw clip lands exactly when the server lets us fire)
  setDrawMs(ms) {
    this.#drawMs = Math.max(120, ms || CLIP_MS.draw);
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

  // SPEC 38.3: the melee swing of a kit style; ignored while one is running
  swing(style, now = performance.now()) {
    const st = meleeStyle(style?.id ?? style);
    if (now - this.#swingStart < st.windupMs + st.activeMs + st.recoveryMs) return;
    this.#swingStart = now;
    this.#swingStyle = st.id;
  }

  // SPEC 38.3: the clash knock; the riposte version is shorter
  clash(riposte, now = performance.now()) {
    this.#clashStart = now;
    this.#clashRiposte = !!riposte;
    this.#swingStart = -Infinity; // the swing is over
  }

  setVisible(on) {
    if (this.#group) this.#group.visible = on;
  }

  // dt seconds; moving: horizontal speed in m/s; ads: target 0/1; sprinting: lowers the weapon (SPEC 38.2)
  update(dt, now, { moving = 0, ads = false, sprinting = false } = {}) {
    if (!this.#group) return;
    this.#kick = Math.max(0, this.#kick - dt * 9);
    this.#ads += ((ads ? 1 : 0) - this.#ads) * Math.min(1, dt * 14);
    const speedNorm = Math.min(1, moving / 6);
    this.#t += dt * (1 + speedNorm * 7);
    this.#idleT += dt;
    const remaining = this.#reloadUntil - now;
    const reloadPhase = remaining > 0 ? 1 - remaining / this.#reloadMs : 0;
    const insAge = now - this.#inspectStart;
    const inspect = insAge >= 0 && insAge < INSPECT_MS && this.#ads < 0.5 ? insAge / INSPECT_MS : 0;
    const base = pose({ ads: this.#ads });
    const melee = meleeClip(this.#swingStyle, now - this.#swingStart);
    const clash = clashClip(now - this.#clashStart, this.#clashRiposte);
    const reload = reloadPhase > 0 ? reloadClip(reloadPhase) : null;
    const p = compose(
      base,
      idleClip(this.#idleT),
      scale(bobClip(this.#t, speedNorm, sprinting && this.#ads < 0.5), 1 - this.#ads),
      drawClip((now - this.#drawStart) / this.#drawMs),
      reload,
      inspect > 0 ? inspectClip(inspect) : null,
      fireClip(this.#kick),
      melee,
      clash,
    );
    this.#group.position.set(p.x, p.y, p.z);
    this.#group.rotation.set(p.pitch, p.yaw, p.roll);
    // left hand follows the reload clip (magazine out, back in)
    const a = this.#arms;
    if (a) {
      const lh = reload?.leftHand ?? { drop: 0, forward: 0 };
      a.leftHand.position.set(a.leftHandRest.x, a.leftHandRest.y - lh.drop, a.leftHandRest.z + lh.forward);
      a.leftArm.position.set(a.leftArmRest.x, a.leftArmRest.y - lh.drop * 0.6, a.leftArmRest.z + lh.forward * 0.5);
      a.blade.visible = !!melee;
      if (melee) a.blade.rotation.set(0, melee.bladeAngle * 0.5, 0.3 * melee.swing);
    }
  }
}

const scale = (c, k) => ({ x: c.x * k, y: c.y * k, z: c.z * k, pitch: c.pitch * k, yaw: c.yaw * k, roll: c.roll * k });
