// Renders replicated ability effects (`snap.fx`, SPEC 24.5): shields, decoys, heal zones, stasis fields. Display only.
import * as THREE from 'three';
import { ABILITIES } from '../shared/abilities.js';
import { teamColorHex } from './arenaStyle.js';

const COLORS = Object.freeze({ shield: 0x7aa2ff, heal: 0x3ddc84, stasis: 0xc084fc });

export class Effects {
  #scene;
  #meshes = new Map();

  constructor(scene) {
    this.#scene = scene;
  }

  sync(fx, now) {
    const seen = new Set();
    for (const f of fx ?? []) {
      seen.add(f.id);
      let obj = this.#meshes.get(f.id);
      if (!obj) {
        obj = this.#create(f);
        if (!obj) continue;
        this.#scene.add(obj);
        this.#meshes.set(f.id, obj);
      }
      obj.position.set(f.x, f.y, f.z);
      if (f.k === 'decoy') obj.rotation.y = f.yaw ?? 0;
      if (f.k === 'heal' || f.k === 'stasis') {
        const pulse = 1 + Math.sin(now * 0.004) * 0.03;
        obj.scale.set(pulse, 1, pulse);
      }
    }
    for (const [id, obj] of this.#meshes) {
      if (seen.has(id)) continue;
      this.#scene.remove(obj);
      this.#meshes.delete(id);
    }
  }

  #create(f) {
    if (f.k === 'shield') {
      const a = ABILITIES.shield;
      const facingX = Math.abs(Math.sin(f.yaw ?? 0)) > Math.abs(Math.cos(f.yaw ?? 0));
      const geo = new THREE.BoxGeometry(facingX ? a.depth : a.width, a.height, facingX ? a.width : a.depth);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLORS.shield, emissive: 0x1d3a8a, transparent: true, opacity: 0.45, roughness: 0.2, metalness: 0.6 }));
      mesh.position.y = a.height / 2;
      const g = new THREE.Group();
      g.add(mesh);
      return g;
    }
    if (f.k === 'decoy') {
      // Same silhouette as a remote player, in the owner's team color, so it reads as a player at a glance.
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: teamColorHex(f.o ?? 0, f.tm ?? -1), roughness: 0.6, metalness: 0.1 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.8), mat);
      body.position.y = 0.65;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat);
      head.position.y = 1.55;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      visor.position.set(0, 1.58, -0.22);
      g.add(body, head, visor);
      return g;
    }
    if (f.k === 'heal' || f.k === 'stasis') {
      const r = f.r ?? (f.k === 'heal' ? ABILITIES.heal.radius : ABILITIES.stasis.radius);
      const g = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS[f.k], transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), new THREE.MeshBasicMaterial({ color: COLORS[f.k], transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(dome, ring);
      return g;
    }
    return null;
  }
}
