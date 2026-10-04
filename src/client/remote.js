import * as THREE from 'three';
import { NAME_TAG, nameTagLayout, teamColorHex } from './arenaStyle.js';
import { PLAYER } from '../shared/constants.js';

const INTERP_DELAY_MS = 100; // render remote players ~3 ticks in the past so there is always a pair to blend

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
};

// Name tags are sprites with a canvas texture, one texture per distinct name (SPEC 19.3). The name
// is drawn with fillText, never injected into the DOM, so a hostile name is just pixels.
const tagTextures = new Map();
function nameTagTexture(name) {
  const layout = nameTagLayout(name);
  let entry = tagTextures.get(layout.text);
  if (entry) return entry;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  const r = layout.height / 2;
  ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, layout.width, layout.height, r);
  ctx.fill();
  ctx.font = NAME_TAG.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(layout.text, layout.width / 2, layout.height / 2 + 1, layout.width - NAME_TAG.padX);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  entry = { texture, scale: layout.scale };
  tagTextures.set(layout.text, entry);
  return entry;
}

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
      if (mesh.userData.name !== pb.name) this.#setTag(mesh, pb.name);
      if (mesh.userData.team !== pb.tm) this.#setTeam(mesh, id, pb.tm);
      // SPEC 23: a crouched or sliding body is squashed to its hitbox height; the tag stays above the head.
      const hk = typeof pb.h === 'number' ? Math.max(0.3, pb.h / PLAYER.height) : 1;
      if (mesh.userData.hk !== hk) this.#setHeight(mesh, hk);
    }
    for (const [id, mesh] of this.#meshes) {
      if (seen.has(id)) continue;
      this.#scene.remove(mesh);
      this.#meshes.delete(id);
    }
  }

  // SPEC 22: body color follows the team in the snapshot (tm); -1 keeps the id parity colors.
  #setTeam(mesh, id, team) {
    mesh.userData.team = team;
    mesh.userData.bodyMaterial?.color.set(teamColorHex(id, team));
  }

  #setHeight(mesh, hk) {
    mesh.userData.hk = hk;
    const body = mesh.userData.body;
    if (body) body.scale.y = hk;
    const tag = mesh.getObjectByName('tag');
    if (tag) tag.position.y = NAME_TAG.y * hk;
  }

  #create(id) {
    const group = new THREE.Group();
    const color = new THREE.Color(teamColorHex(id));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    group.userData.bodyMaterial = mat;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.8), mat);
    body.position.y = 0.65;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat);
    head.position.y = 1.55;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }));
    visor.position.set(0, 1.58, -0.22); // faces -Z, the direction yaw 0 looks
    for (const m of [body, head, visor]) { m.castShadow = true; m.receiveShadow = true; }
    const bodyGroup = new THREE.Group();
    bodyGroup.add(body, head, visor);
    group.add(bodyGroup);
    group.userData.body = bodyGroup;
    this.#scene.add(group);
    this.#meshes.set(id, group);
    return group;
  }

  #setTag(group, name) {
    group.userData.name = name;
    const old = group.getObjectByName('tag');
    if (old) group.remove(old);
    const { texture, scale } = nameTagTexture(name);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, fog: false }));
    sprite.name = 'tag';
    sprite.scale.set(...scale);
    sprite.position.y = NAME_TAG.y * (group.userData.hk ?? 1);
    group.add(sprite);
  }
}
