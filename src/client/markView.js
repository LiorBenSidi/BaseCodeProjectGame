// SPEC 39.8: team marks in the world. Each mark is a thin vertical beam and a floor disc in the kind's colour, fading
// over the last second of its life. Pure list math lives in shared/comms.js; this class only draws.
import * as THREE from 'three';
import { MARK_KINDS, pruneMarks } from '../shared/comms.js';

export class MarkView {
  #group = new THREE.Group();
  #meshes = new Map(); // key -> { beam, disc, mats }
  constructor(scene) { scene.add(this.#group); }

  // marks: the live list from comms.addMark (mutated by prune); nowMs: performance clock the list was built on.
  update(marks, nowMs) {
    pruneMarks(marks, nowMs);
    const live = new Set();
    for (const m of marks) {
      const key = `${m.from}:${m.at}`;
      live.add(key);
      let v = this.#meshes.get(key);
      if (!v) {
        const color = new THREE.Color(MARK_KINDS[m.kind]?.color ?? '#e6edf3');
        const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 3.2, 8), beamMat);
        beam.position.set(m.pos[0], m.pos[1] + 1.6, m.pos[2]);
        const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
        const disc = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.6, 24), discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(m.pos[0], m.pos[1] + 0.03, m.pos[2]);
        this.#group.add(beam, disc);
        v = { beam, disc, mats: [beamMat, discMat] };
        this.#meshes.set(key, v);
      }
      const left = m.until - nowMs;
      const fade = Math.max(0, Math.min(1, left / 1000));
      v.mats[0].opacity = 0.55 * fade; v.mats[1].opacity = 0.45 * fade;
      v.disc.scale.setScalar(1 + 0.15 * Math.sin(nowMs / 180));
    }
    for (const [key, v] of this.#meshes) if (!live.has(key)) { this.#group.remove(v.beam, v.disc); this.#meshes.delete(key); }
  }

  clear() { for (const v of this.#meshes.values()) this.#group.remove(v.beam, v.disc); this.#meshes.clear(); }
}
