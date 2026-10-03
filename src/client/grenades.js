// Renders server-replicated grenades (`snap.nades`) and explosions (`boom`). Display only.
import * as THREE from 'three';

const BLAST_MS = 450;

export class Grenades {
  #scene;
  #meshes = new Map();
  #blasts = [];
  #geometry = new THREE.SphereGeometry(0.12, 10, 8);
  #material = new THREE.MeshStandardMaterial({ color: 0x3b4a2a });

  constructor(scene) {
    this.#scene = scene;
  }

  sync(nades) {
    const seen = new Set();
    for (const n of nades) {
      seen.add(n.id);
      let mesh = this.#meshes.get(n.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.#geometry, this.#material);
        this.#scene.add(mesh);
        this.#meshes.set(n.id, mesh);
      }
      mesh.position.set(n.x, n.y, n.z);
    }
    for (const [id, mesh] of this.#meshes) {
      if (seen.has(id)) continue;
      this.#scene.remove(mesh);
      this.#meshes.delete(id);
    }
  }

  explode(at, now) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.8 }),
    );
    mesh.position.set(...at);
    this.#scene.add(mesh);
    this.#blasts.push({ mesh, born: now });
  }

  update(now) {
    this.#blasts = this.#blasts.filter((b) => {
      const k = (now - b.born) / BLAST_MS;
      if (k < 1) {
        b.mesh.scale.setScalar(0.5 + k * 4.5); // grows to the 5 m blast radius
        b.mesh.material.opacity = 0.8 * (1 - k);
        return true;
      }
      this.#scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      return false;
    });
  }
}
