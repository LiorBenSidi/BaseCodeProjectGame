// Builds the visual props of a map (SPEC 30.4) from shared/props.js data with primitive geometry and the theme
// palette. Display only; no collision. Lamps emit a small point light on medium and high quality.
import * as THREE from 'three';
import { propsFor } from '../shared/props.js';
import { surfaceMaterial } from './textures.js';

const MAX_LAMP_LIGHTS = 8;

export function buildProps(map, theme, quality) {
  const group = new THREE.Group();
  const props = propsFor(map);
  const crateMat = surfaceMaterial('metal', theme.cover.color, [1, 1], quality.textureSize);
  const barrelMat = new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.5, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.6, metalness: 0.4 });
  const glowMat = new THREE.MeshStandardMaterial({ color: theme.accent, emissive: theme.accent, emissiveIntensity: 1.6 });
  const trimMat = new THREE.MeshStandardMaterial({ color: theme.accent, emissive: theme.accent, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.5 });
  let lights = 0;
  for (const p of props) {
    if (p.kind === 'crate') {
      const s = p.s ?? 0.8;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      m.position.set(p.x, p.y + s / 2, p.z);
      m.rotation.y = p.ry ?? 0;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    } else if (p.kind === 'barrel') {
      const s = p.s ?? 0.8;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.35, s * 0.35, s, 12), barrelMat);
      m.position.set(p.x, p.y + s / 2, p.z);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    } else if (p.kind === 'lamp') {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), lampMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), glowMat);
      const g = new THREE.Group();
      arm.position.set(0, 0, -0.25);
      head.position.set(0, -0.05, -0.5);
      g.add(arm, head);
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.ry ?? 0;
      if (quality.shadows && lights < MAX_LAMP_LIGHTS) {
        const light = new THREE.PointLight(theme.accent, 6, 14, 2);
        light.position.set(0, -0.3, -0.6);
        g.add(light);
        lights += 1;
      }
      group.add(g);
    } else if (p.kind === 'trim') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, p.sx), 0.12, Math.max(0.2, p.sz)), trimMat);
      m.position.set(p.x, p.y + 0.06, p.z);
      group.add(m);
    }
  }
  return group;
}
