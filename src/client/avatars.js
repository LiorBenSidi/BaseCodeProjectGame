// Kit avatars (SPEC 28.2): the same box figure for everyone, plus one kit accent so a glance tells
// a Vanguard from a Medic. Pure layout table + a Three.js builder; the body material is shared so the
// team color still drives the whole figure. Index = `kt` from the snapshot (KIT_IDS order).
import * as THREE from 'three';
import { KIT_IDS } from '../shared/abilities.js';

// Accent pieces per kit: box parts [w, h, d, x, y, z] in body space (facing -Z) and an accent color.
export const KIT_ACCENTS = Object.freeze({
  vanguard: Object.freeze({ color: 0x9aa4b2, parts: [[1.1, 0.25, 0.9, 0, 1.25, 0], [0.3, 0.6, 0.3, -0.6, 0.9, 0], [0.3, 0.6, 0.3, 0.6, 0.9, 0]] }), // shoulder plate + pauldrons
  phantom: Object.freeze({ color: 0x22263a, parts: [[0.5, 0.2, 0.5, 0, 1.8, 0], [0.9, 0.9, 0.15, 0, 0.75, 0.45]] }), // hood + cloak
  engineer: Object.freeze({ color: 0xf59e0b, parts: [[0.6, 0.7, 0.3, 0, 0.9, 0.5], [0.12, 0.5, 0.12, 0.2, 1.9, 0]] }), // backpack + antenna
  medic: Object.freeze({ color: 0x3ddc84, parts: [[0.12, 0.45, 0.05, 0, 0.95, -0.42], [0.45, 0.12, 0.05, 0, 0.95, -0.42]] }), // chest cross
});

export const kitIdFor = (kt) => KIT_IDS[kt] ?? KIT_IDS[0];

export function accentFor(kt) {
  return KIT_ACCENTS[kitIdFor(kt)];
}

// Adds the accent meshes to a body group; removes the previous accent first. Returns the kit id.
export function applyKitAccent(bodyGroup, kt) {
  const old = bodyGroup.getObjectByName('kit-accent');
  if (old) bodyGroup.remove(old);
  const acc = accentFor(kt);
  const g = new THREE.Group();
  g.name = 'kit-accent';
  const mat = new THREE.MeshStandardMaterial({ color: acc.color, roughness: 0.5, metalness: 0.3 });
  for (const [w, h, d, x, y, z] of acc.parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  }
  bodyGroup.add(g);
  return kitIdFor(kt);
}
