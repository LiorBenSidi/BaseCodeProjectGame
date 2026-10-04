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

function geometryFor(shape) {
  if (shape === 'cross') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16)));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16)));
    return g;
  }
  if (shape === 'gun') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.12)));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.12));
    grip.position.set(-0.15, -0.18, 0);
    g.add(grip);
    return g;
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.26)));
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
      group.traverse((o) => { if (o.isMesh) o.material = material; });
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
