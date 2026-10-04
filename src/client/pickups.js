// Renders pickup spots (SPEC 21.1): the list arrives once in `welcome`, availability per snapshot in
// `snap.items` (indices of spots that can be taken right now). Display only; the server decides who takes what.
import * as THREE from 'three';

export const PICKUP_STYLE = Object.freeze({
  health: Object.freeze({ color: 0x3ddc84, emissive: 0x0f5c34, shape: 'cross' }),
  ammo: Object.freeze({ color: 0xf0b429, emissive: 0x6b4a05, shape: 'box' }),
  smg: Object.freeze({ color: 0x7aa2ff, emissive: 0x1d3a8a, shape: 'gun' }),
  shotgun: Object.freeze({ color: 0xff8a3d, emissive: 0x7a3300, shape: 'gun' }),
  sniper: Object.freeze({ color: 0xe06cff, emissive: 0x5a1a7a, shape: 'gun' }),
});

const SPIN_RAD_PER_MS = 0.0018;
const BOB_AMPLITUDE = 0.12;
const BOB_RAD_PER_MS = 0.003;
const HOVER_Y = 0.9;

// SPEC 30.7: small readable models. A medkit case with a cross, an ammo can with brass tips, a gun silhouette.
// The accent material (set by the caller) colors the recognisable part; the case material is neutral.
const CASE_MAT = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5, metalness: 0.1 });
const CAN_MAT = new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 0.6, metalness: 0.3 });

function geometryFor(shape) {
  const g = new THREE.Group();
  if (shape === 'cross') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.3), CASE_MAT);
    g.add(body);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.04)); a.position.z = 0.17;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.04)); b.position.z = 0.17;
    const a2 = a.clone(); a2.position.z = -0.17; const b2 = b.clone(); b2.position.z = -0.17;
    g.add(a, b, a2, b2);
    g.userData.accentOnly = true;
    return g;
  }
  if (shape === 'gun') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.12)));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.12));
    grip.position.set(-0.15, -0.18, 0);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1));
    mag.position.set(0.08, -0.15, 0);
    g.add(grip, mag);
    return g;
  }
  const can = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.26), CAN_MAT);
  g.add(can);
  for (let i = 0; i < 3; i++) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8));
    tip.position.set(-0.08 + i * 0.08, 0.19, 0);
    g.add(tip);
  }
  g.userData.accentOnly = true;
  return g;
}

export class Pickups {
  #scene;
  #spots = new Map(); // i -> { group, ring, material }
  #available = new Set();

  constructor(scene) {
    this.#scene = scene;
  }

  // welcome.pickups: [{ i, type, x, y, z }]
  setSpots(list) {
    for (const { group } of this.#spots.values()) this.#scene.remove(group);
    this.#spots.clear();
    for (const s of list ?? []) {
      const style = PICKUP_STYLE[s.type];
      if (!style) continue;
      const material = new THREE.MeshStandardMaterial({ color: style.color, emissive: style.emissive, roughness: 0.35, metalness: 0.4 });
      const group = geometryFor(style.shape);
      group.traverse((o) => { if (o.isMesh && (!group.userData.accentOnly || o.material === undefined || o.material.type === 'MeshBasicMaterial')) o.material = material; });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24), new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.x, s.y + 0.02, s.z);
      group.position.set(s.x, s.y + HOVER_Y, s.z);
      group.userData.baseY = s.y + HOVER_Y;
      this.#scene.add(group);
      this.#scene.add(ring);
      this.#spots.set(s.i, { group, ring, material });
    }
  }

  // snap.items: indices available now.
  sync(items) {
    this.#available = new Set(items ?? []);
    for (const [i, { group, ring }] of this.#spots) {
      const on = this.#available.has(i);
      group.visible = on;
      ring.material.opacity = on ? 0.35 : 0.08;
    }
  }

  update(now) {
    for (const { group } of this.#spots.values()) {
      if (!group.visible) continue;
      group.rotation.y = (now * SPIN_RAD_PER_MS) % (Math.PI * 2);
      group.position.y = group.userData.baseY + Math.sin(now * BOB_RAD_PER_MS) * BOB_AMPLITUDE;
    }
  }
}

// HUD line for a `pickup` message. Pure.
export function pickupText(m) {
  if (m.kind === 'health') return `+${m.amount} health`;
  if (m.kind === 'ammo') return `+${m.amount} ammo`;
  if (m.kind === 'weapon') return `Picked up ${m.weapon ? m.weapon[0].toUpperCase() + m.weapon.slice(1) : 'weapon'}`;
  return '';
}
