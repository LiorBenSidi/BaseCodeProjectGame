import * as THREE from 'three';
import { thirdPersonMelee } from './animClips.js'; // SPEC 38.2
import { KIT_IDS } from '../shared/abilities.js';
import { NAME_TAG, nameTagLayout, teamColorHex } from './arenaStyle.js';
import { applyKitAccent } from './avatars.js';
import { PLAYER } from '../shared/constants.js';
import { RIG, walkCycle, advancePhase, hitFlash, deathPose } from './characterRig.js';
import { weaponModel, MATERIALS } from './weaponModels.js';
import { trimHistory } from './ceremony.js'; // PRO-ceremony

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
    const now = performance.now();
    for (const p of players) if (p.id !== selfId) others.set(p.id, p);
    this.#buffer.push({ t: now, players: others });
    if (this.#buffer.length > 30) this.#buffer.shift();
    // PRO-ceremony (SPEC 34.5): 6 s of history per player for the kill cam
    for (const [id, p] of others) {
      let h = this.#history.get(id);
      if (!h) { h = []; this.#history.set(id, h); }
      h.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0, h: p.h });
      trimHistory(h, now);
    }
    for (const id of this.#history.keys()) if (!others.has(id)) this.#history.delete(id);
    this.#last = others;
  }

  // PRO-ceremony begin (SPEC 34.5 / 34.6)
  #history = new Map();
  #last = new Map();
  #hidden = new Set();

  historyOf(id) {
    return this.#history.get(id) ?? [];
  }

  // The last snapshot's other players, for the minimap.
  lastPlayers() {
    return [...this.#last.values()];
  }

  // Hides a player's mesh while the kill cam looks out of their eyes.
  setHidden(id, hidden) {
    if (hidden) this.#hidden.add(id); else this.#hidden.delete(id);
    const mesh = this.#meshes.get(id);
    if (mesh && hidden) mesh.visible = false;
  }
  // PRO-ceremony end

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
      const x = lerp(pa.x, pb.x, k), y = lerp(pa.y, pb.y, k), z = lerp(pa.z, pb.z, k);
      // SPEC 31.2 animation: phase follows distance travelled, limbs follow walkCycle, the head follows pitch
      const speed = Math.hypot(x - (mesh.userData.lx ?? x), z - (mesh.userData.lz ?? z)) / Math.max(1e-3, (now - (mesh.userData.lt ?? now)) / 1000);
      const dt = Math.min(0.1, (now - (mesh.userData.lt ?? now)) / 1000);
      mesh.userData.lx = x; mesh.userData.lz = z; mesh.userData.lt = now;
      const airborne = typeof pb.vy === 'number' && Math.abs(pb.vy) > 0.5 && y > 0.05;
      mesh.userData.phase = advancePhase(mesh.userData.phase, airborne ? 0 : Math.min(speed, 12), dt);
      const hk0 = typeof pb.h === 'number' ? Math.max(0.3, pb.h / PLAYER.height) : 1;
      const cyc = walkCycle(mesh.userData.phase, speed, { airborne, crouchK: hk0 });
      const j = mesh.userData.joints;
      j.legL.rotation.x = cyc.legL; j.legR.rotation.x = cyc.legR;
      j.armL.rotation.x = -1.0 + cyc.armSwing * 0.3; j.armR.rotation.x = -1.2 - cyc.armSwing * 0.3;
      // SPEC 38.2 / 38.3: reload drops the left hand off the weapon; a melee phase (ml) swings the right arm and shows the blade
      const ud = mesh.userData;
      if ((pb.rel === 1) !== ud.reloading) { ud.reloading = pb.rel === 1; ud.reloadAt = now; }
      if (ud.reloading) j.armL.rotation.x = -0.35 - 0.2 * Math.sin(Math.min(1, (now - ud.reloadAt) / 600) * Math.PI);
      const ml = pb.ml ?? 0;
      if (ml !== ud.ml) { ud.ml = ml; ud.mlAt = now; }
      const tp = ml ? thirdPersonMelee(KIT_IDS[pb.kt] ?? 'vanguard', ml, now - ud.mlAt) : null;
      const blade = ud.body.getObjectByName('blade');
      if (blade) blade.visible = !!tp && ml !== 4;
      if (tp) {
        j.armR.rotation.x = tp.armPitch;
        j.armR.rotation.y = -tp.bladeAngle * 0.6;
        if (blade) blade.rotation.set(0, tp.bladeAngle, 0);
        if (tp.shake > 0) ud.body.rotation.z = Math.sin(now * 0.05) * 0.08 * tp.shake;
      } else { j.armR.rotation.y = 0; if (ml === 0) ud.body.rotation.z = 0; }
      j.head.rotation.x = -(pb.pitch ?? 0) * 0.6;
      mesh.userData.body.rotation.x = cyc.lean;
      mesh.position.set(x, y + cyc.bob, z);
      mesh.rotation.y = lerpAngle(pa.yaw, pb.yaw, k);
      // SPEC 31.3: hit flash and death pose
      const flash = hitFlash(now - mesh.userData.hitAt);
      mesh.userData.bodyMaterial.emissive.setScalar(flash * 0.9);
      if (pb.alive === 1) { mesh.userData.deadAt = null; mesh.visible = !this.#hidden.has(id); // PRO-ceremony: hidden while the kill cam uses their eyes
        mesh.rotation.z = 0; mesh.position.y = y + cyc.bob; }
      else {
        if (mesh.userData.deadAt === null) mesh.userData.deadAt = now;
        const dp = deathPose(now - mesh.userData.deadAt);
        mesh.visible = dp.fade < 1 && !this.#hidden.has(id);
        mesh.rotation.z = dp.roll;
        mesh.position.y = y - dp.sink;
      }
      if (mesh.userData.w !== pb.w && typeof pb.w === 'string') this.#setWeapon(mesh, pb.w);
      if (mesh.userData.name !== pb.name) this.#setTag(mesh, pb.name);
      if (mesh.userData.team !== pb.tm) this.#setTeam(mesh, id, pb.tm);
      // SPEC 23: a crouched or sliding body is squashed to its hitbox height; the tag stays above the head.
      const hk = typeof pb.h === 'number' ? Math.max(0.3, pb.h / PLAYER.height) : 1;
      if (mesh.userData.hk !== hk) this.#setHeight(mesh, hk);
      // SPEC 28.2: kit accent follows the snapshot's kit index
      if (mesh.userData.kt !== pb.kt) { mesh.userData.kt = pb.kt; applyKitAccent(mesh.userData.body, pb.kt); }
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

  // SPEC 31.2: an articulated figure (torso, pelvis, head, visor, two arms, two legs) in one team colored material,
  // plus the weapon in hand (SPEC 31.1 shared model). Limb pivots are groups so the walk cycle rotates them.
  #create(id) {
    const group = new THREE.Group();
    const color = new THREE.Color(teamColorHex(id));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, emissive: 0x000000 });
    group.userData.bodyMaterial = mat;
    const box = (dims, m = mat) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), m); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
    const place = (mesh, dims) => { mesh.position.set(dims[3], dims[4], dims[5]); return mesh; };
    const bodyGroup = new THREE.Group();
    const torso = place(box(RIG.torso), RIG.torso);
    const pelvis = place(box(RIG.pelvis), RIG.pelvis);
    const head = place(box(RIG.head), RIG.head);
    const visor = place(box(RIG.visor, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 })), RIG.visor); // faces -Z, the direction yaw 0 looks
    bodyGroup.add(torso, pelvis, head, visor);
    const limb = (dims, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = box(dims);
      mesh.position.y = -dims[1] / 2;
      pivot.add(mesh);
      return pivot;
    };
    const legL = limb(RIG.leg, -RIG.hipX, RIG.hipY), legR = limb(RIG.leg, RIG.hipX, RIG.hipY);
    const armL = limb(RIG.upperArm, -RIG.shoulderX, RIG.shoulderY), armR = limb(RIG.upperArm, RIG.shoulderX, RIG.shoulderY);
    armR.rotation.x = -1.2; armL.rotation.x = -1.0; armL.rotation.y = 0.5; // both hands forward on the weapon
    bodyGroup.add(legL, legR, armL, armR);
    const weapon = new THREE.Group();
    weapon.name = 'weapon';
    weapon.position.set(RIG.weaponHold.x, RIG.weaponHold.y, RIG.weaponHold.z);
    bodyGroup.add(weapon);
    // SPEC 38.3: the kit blade in the right hand, shown only while the snapshot says a swing is in flight
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.25, metalness: 0.9, emissive: 0x223344 }));
    blade.name = 'blade';
    blade.position.set(RIG.shoulderX, RIG.shoulderY - 0.45, -0.35);
    blade.visible = false;
    bodyGroup.add(blade);
    group.add(bodyGroup);
    group.userData.body = bodyGroup;
    group.userData.joints = { legL, legR, armL, armR, torso, head };
    group.userData.phase = Math.random() * Math.PI * 2;
    group.userData.hitAt = -Infinity;
    group.userData.deadAt = null;
    this.#scene.add(group);
    this.#meshes.set(id, group);
    return group;
  }

  #setWeapon(mesh, w) {
    mesh.userData.w = w;
    const holder = mesh.userData.body.getObjectByName('weapon');
    if (!holder) return;
    holder.clear();
    const model = weaponModel(w);
    const mats = { body: new THREE.MeshStandardMaterial(MATERIALS.body), wood: new THREE.MeshStandardMaterial(MATERIALS.wood), glass: new THREE.MeshStandardMaterial(MATERIALS.glass), accent: new THREE.MeshStandardMaterial({ color: model.accent, roughness: 0.4, metalness: 0.5 }) };
    for (const [bw, bh, bd, x, y, z, m] of model.parts) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mats[m] ?? mats.body);
      part.position.set(x, y, z);
      part.castShadow = true;
      holder.add(part);
    }
  }

  // SPEC 31.3: a verdict with damage flashes the victim for 120 ms so the shooter sees the hit land.
  // SPEC 38.3: a melee broadcast arrives before the snapshot phase; it primes the clip so the swing starts on time
  swing(id, style) {
    const mesh = this.#meshes.get(id);
    if (!mesh) return;
    mesh.userData.ml = 1; mesh.userData.mlAt = performance.now(); mesh.userData.swingStyle = style;
  }

  // World position of a remote player as last rendered, or null (sound placement for melee and clash cues).
  positionOf(id) {
    const mesh = this.#meshes.get(id);
    return mesh ? [mesh.position.x, mesh.position.y, mesh.position.z] : null;
  }

  flash(id, now = performance.now()) {
    const mesh = this.#meshes.get(id);
    if (mesh) mesh.userData.hitAt = now;
  }

  // SPEC 29.5: visible remote players moving faster than 1 m/s, with their interpolated position.
  // SPEC 32.5 (PRO-feel): live others from the latest snapshot, eye height included, for the aim assist cone.
  latest() {
    const last = this.#buffer[this.#buffer.length - 1];
    if (!last) return [];
    const out = [];
    for (const p of last.players.values()) if (p.alive === 1) out.push({ id: p.id, x: p.x, y: p.y + 1.4, z: p.z, team: p.tm });
    return out;
  }

  moving(now) {
    const buf = this.#buffer;
    if (buf.length < 2) return [];
    const a = buf[buf.length - 2];
    const b = buf[buf.length - 1];
    const dtS = Math.max(0.001, (b.t - a.t) / 1000);
    const out = [];
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa || pb.alive !== 1) continue;
      const speed = Math.hypot(pb.x - pa.x, pb.z - pa.z) / dtS;
      if (speed > 1 && (typeof pb.y !== 'number' || pb.y < 0.05 || pb.y === pa.y)) out.push({ id, speed, x: pb.x, z: pb.z, now });
    }
    return out;
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
