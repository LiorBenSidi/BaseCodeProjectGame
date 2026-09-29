import * as THREE from 'three';

const INTERP_DELAY_MS = 100; // render remote players ~3 ticks in the past so there is always a pair to blend

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
};

// Snapshot interpolation for the other players. The local player is predicted, not interpolated.
export class RemotePlayers {
  #scene;
  #meshes = new Map();
  #buffer = [];

  constructor(scene) {
    this.#scene = scene;
  }

  push(players, selfId) {
    const others = new Map();
    for (const p of players) if (p.id !== selfId) others.set(p.id, p);
    this.#buffer.push({ t: performance.now(), players: others });
    if (this.#buffer.length > 30) this.#buffer.shift();
  }

  update(now) {
    const buf = this.#buffer;
    if (buf.length === 0) return;
    const renderTime = now - INTERP_DELAY_MS;
    while (buf.length > 2 && buf[1].t <= renderTime) buf.shift();
    const a = buf[0];
    const b = buf[1] ?? buf[0];
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;

    const seen = new Set();
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id) ?? pb;
      seen.add(id);
      const mesh = this.#meshes.get(id) ?? this.#create(id);
      mesh.position.set(lerp(pa.x, pb.x, k), lerp(pa.y, pb.y, k), lerp(pa.z, pb.z, k));
      mesh.rotation.y = lerpAngle(pa.yaw, pb.yaw, k);
      mesh.visible = pb.alive === 1;
    }
    for (const [id, mesh] of this.#meshes) {
      if (seen.has(id)) continue;
      this.#scene.remove(mesh);
      this.#meshes.delete(id);
    }
  }

  #create(id) {
    const group = new THREE.Group();
    const color = new THREE.Color().setHSL(((id * 67) % 360) / 360, 0.6, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.8), mat);
    body.position.y = 0.65;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat);
    head.position.y = 1.55;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    visor.position.set(0, 1.58, -0.22); // faces -Z, the direction yaw 0 looks
    group.add(body, head, visor);
    this.#scene.add(group);
    this.#meshes.set(id, group);
    return group;
  }
}
