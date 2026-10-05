// SPEC 39: the objective in the world. KOTH: a flat ring on the floor at the hill, tinted by the holder (white open,
// amber contested, team colour held), with a slow pulse. CTF: a low pad at each base and a flag pole with a cloth
// per team; the flag follows its carrier, lies tilted when dropped, stands at the base when home.
import * as THREE from 'three';

const TEAM_HEX = [0x5ce1ff, 0xff5252];
const OPEN_HEX = 0xe6edf3;
const CONTESTED_HEX = 0xffb347;

export class ObjectiveView {
  #group = new THREE.Group();
  #hill = null; // { ring, mat, x, z }
  #ctf = null; // { pads: [], flags: [{ pole, cloth, mat }] }
  #kind = null;

  constructor(scene) {
    scene.add(this.#group);
  }

  // Called per snapshot with match.obj (null clears the view).
  update(obj, nowMs = 0) {
    if (!obj) { this.clear(); return; }
    if (obj.kind !== this.#kind) { this.clear(); this.#kind = obj.kind; }
    if (obj.kind === 'hill') this.#updateHill(obj, nowMs);
    else if (obj.kind === 'flags') this.#updateFlags(obj, nowMs);
  }

  #updateHill(obj, nowMs) {
    if (!this.#hill) {
      const mat = new THREE.MeshBasicMaterial({ color: OPEN_HEX, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(obj.r - 0.35, obj.r, 48), mat);
      ring.rotation.x = -Math.PI / 2;
      const fillMat = new THREE.MeshBasicMaterial({ color: OPEN_HEX, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
      const fill = new THREE.Mesh(new THREE.CircleGeometry(obj.r - 0.35, 48), fillMat);
      fill.rotation.x = -Math.PI / 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 8), new THREE.MeshBasicMaterial({ color: OPEN_HEX, transparent: true, opacity: 0.35, depthWrite: false }));
      post.position.y = 3;
      const g = new THREE.Group();
      g.add(ring, fill, post);
      this.#group.add(g);
      this.#hill = { g, ring, fill, post, mat, fillMat, x: NaN, z: NaN };
    }
    const h = this.#hill;
    if (h.x !== obj.x || h.z !== obj.z) { h.g.position.set(obj.x, 0.03, obj.z); h.x = obj.x; h.z = obj.z; }
    const hex = obj.contested ? CONTESTED_HEX : obj.holder < 0 ? OPEN_HEX : TEAM_HEX[obj.holder];
    h.mat.color.setHex(hex); h.fillMat.color.setHex(hex); h.post.material.color.setHex(hex);
    const pulse = 0.35 + 0.15 * (0.5 + 0.5 * Math.sin(nowMs / 350));
    h.mat.opacity = obj.contested ? pulse + 0.2 : pulse;
    h.fillMat.opacity = obj.holder >= 0 || obj.contested ? 0.16 : 0.08;
  }

  #updateFlags(obj, nowMs) {
    if (!this.#ctf) {
      const pads = obj.bases.map((b, t) => {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.08, 32), new THREE.MeshBasicMaterial({ color: TEAM_HEX[t], transparent: true, opacity: 0.25, depthWrite: false }));
        pad.position.set(b.x, 0.04, b.z);
        this.#group.add(pad);
        return pad;
      });
      const flags = obj.flags.map((f) => {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), new THREE.MeshBasicMaterial({ color: 0xe6edf3 }));
        pole.position.y = 1.3;
        const mat = new THREE.MeshBasicMaterial({ color: TEAM_HEX[f.team], side: THREE.DoubleSide });
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), mat);
        cloth.position.set(0.47, 2.3, 0);
        g.add(pole, cloth);
        this.#group.add(g);
        return { g, pole, cloth, mat };
      });
      this.#ctf = { pads, flags };
    }
    obj.flags.forEach((f, i) => {
      const v = this.#ctf.flags[i];
      if (!v) return;
      v.g.position.set(f.x, 0, f.z);
      v.g.rotation.z = f.state === 'dropped' ? 0.9 : 0;
      v.g.rotation.y = nowMs / 900; // the cloth turns slowly so it reads from every side
      v.g.scale.setScalar(f.state === 'carried' ? 0.6 : 1);
      v.g.position.y = f.state === 'carried' ? 1.0 : 0;
    });
  }

  clear() {
    this.#group.clear();
    this.#hill = null;
    this.#ctf = null;
    this.#kind = null;
  }
}
