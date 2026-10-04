import { INPUT_DT, PLAYER } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { stepPlayer, eyeOf } from '../shared/movement.js';
import { ClockSync } from './clockSync.js';
import { CombatHud } from './combatHud.js';
import { Grenades } from './grenades.js';
import { Pickups, pickupText } from './pickups.js';
import { Effects } from './effects.js';
import { KITS } from '../shared/abilities.js';
import { PERKS } from '../shared/progression.js';
import { Hud } from './hud.js';
import { attributeDamage, calculateDamageAngle, pruneThreats } from './hudModel.js';
import { Input } from './input.js';
import { Network } from './net.js';
import { ActorNetwork, roomIdFromLocation } from './netActor.js';
import { createClient } from '@base44/sdk';
import { RemotePlayers } from './remote.js';
import { createScene } from './scene.js';
import { TouchControls } from './touch.js';

const TRACER_MS = 90;
const MAX_PENDING = 600; // ~10 s of unacknowledged commands; beyond that the connection is effectively dead

// Client-side prediction + server reconciliation:
//   1. every fixed step we build a command, apply it locally at once, and send it;
//   2. when a snapshot arrives we adopt the server's state for our player, then re-apply every
//      command the server has not yet acknowledged (`ack`), so we stay in sync without rubber-banding.
// This only works because shared/movement.js is deterministic and used by both sides.
export class Game {
  #gfx;
  #input;
  #hud = new Hud();
  #combat = new CombatHud();
  #grenades;
  #touch;
  #remote;
  #net = null;
  #name = '';
  #me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, alive: false };
  #id = null;
  #seq = 0;
  #pending = [];
  #accumulator = 0;
  #lastFrame = performance.now();
  #fps = { on: false, frames: 0, since: performance.now() };
  #clock = new ClockSync(); // SPEC 18.2: room clock estimate and RTT from ping/pong
  #lastShot = 0;
  #weapon = WEAPONS.rifle; // SPEC 20: the weapon the server says is in hand; paces our shoot intents and recoil
  #recoil = { pitch: 0, yaw: 0 }; // SPEC 20: client-only camera kick, recovers over a few frames
  #tracers = [];
  #pickups;
  #effects;
  #kit = 'vanguard';
  #self = null; // SPEC 24.5 private block of the last snapshot
  #sdk = null;
  #roomId = null;
  #threats = [];
  #lastHp = null;
  #eyeY = null; // SPEC 23 smoothed camera height

  constructor(canvas) {
    this.#gfx = createScene(canvas);
    this.#input = new Input(canvas);
    this.#remote = new RemotePlayers(this.#gfx.scene);
    this.#grenades = new Grenades(this.#gfx.scene);
    this.#pickups = new Pickups(this.#gfx.scene); // SPEC 21.1
    this.#effects = new Effects(this.#gfx.scene); // SPEC 24.5
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.#hud.setScoreboardVisible(true); }
      if (e.code === 'KeyG' && !e.repeat && this.#input.locked) this.throwGrenade();
      // SPEC 20.3: weapon intents; the server's state machine decides whether they take effect.
      if (e.code === 'KeyR' && !e.repeat && this.#input.locked) this.reload();
      if (e.code === 'Digit1' && this.#input.locked) this.switchWeapon('primary');
      if (e.code === 'Digit2' && this.#input.locked) this.switchWeapon('sidearm');
      // SPEC 24.1: Q / E abilities; SPEC 25.3: 3 / 4 pick a perk from the open offer
      if (e.code === 'KeyQ' && !e.repeat && this.#input.locked) this.useAbility(0);
      if (e.code === 'KeyE' && !e.repeat && this.#input.locked) this.useAbility(1);
      if (e.code === 'Digit3' && !e.repeat) this.pickPerk(0);
      if (e.code === 'Digit4' && !e.repeat) this.pickPerk(1);
    });
    window.addEventListener('wheel', (e) => {
      if (!this.#input.locked || e.deltaY === 0) return;
      this.switchWeapon(this.#weapon.slot === 'primary' ? 'sidearm' : 'primary');
    }, { passive: true });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.#hud.setScoreboardVisible(false);
    });
    this.#touch = new TouchControls(this.#input, {
      grenade: () => this.throwGrenade(),
      reload: () => this.reload(),
      swap: () => this.switchWeapon(this.#weapon.slot === 'primary' ? 'sidearm' : 'primary'),
      scoreboard: (show) => this.#hud.setScoreboardVisible(show),
    });
    requestAnimationFrame((t) => this.#frame(t));
  }

  // Must run inside the Play gesture (fullscreen / orientation lock need one).
  enableTouch() {
    this.#touch.enable();
  }

  /** SPEC 19.4: the touch override changed in settings; re-resolve without a reload. */
  updateTouchMode() {
    this.#touch.updateMode(this.joined);
  }

  /** SPEC 19.2: mouse sensitivity from the settings panel, applied to the next mouse move. */
  setSensitivity(value) {
    this.#input.sensitivity = value;
  }

  /** SPEC 19.2: FPS readout, measured from frame deltas and refreshed twice a second. */
  setShowFps(on) {
    this.#fps.on = on === true;
    const el = document.getElementById('fps');
    if (el) el.hidden = !this.#fps.on;
  }

  get joined() {
    return this.#id !== null;
  }

  // Intent helpers, shared by the real controls and the ?debug=1 harness. The server decides every result.
  aim(yaw, pitch) {
    this.#input.yaw = yaw;
    this.#input.pitch = Math.max(-1.5533, Math.min(1.5533, pitch));
  }

  fire() {
    return this.#tryFire(performance.now());
  }

  reload() {
    if (!this.joined || !this.#me.alive) return;
    this.#net.send({ t: 'reload' });
  }

  switchWeapon(slot) {
    if (!this.joined || !this.#me.alive || slot === this.#weapon.slot) return;
    this.#net.send({ t: 'switch', slot });
  }

  throwGrenade() {
    if (!this.joined || !this.#me.alive) return false;
    this.#net.send({ t: 'throw' });
    return true;
  }

  // SPEC 24.1: the server validates cooldown, life and phase; the HUD chip shows the result.
  useAbility(slot) {
    if (!this.joined || !this.#me.alive) return false;
    this.#net.send({ t: 'ability', slot });
    return true;
  }

  // SPEC 25.3: picks the i-th perk of the open offer.
  pickPerk(i) {
    const offer = this.#self?.offer;
    if (!this.joined || !offer || !offer[i]) return false;
    this.#net.send({ t: 'perk', id: offer[i] });
    return true;
  }

  // SPEC 24.1: a kit change applies on the next spawn.
  selectKit(id) {
    if (!KITS[id]) return;
    this.#kit = id;
    if (this.joined) { this.#net.send({ t: 'kit', id }); this.#hud.killFeed(`${KITS[id].name} kit on next spawn`); }
  }

  debugState() {
    return { joined: this.joined, id: this.#id, alive: this.#me.alive, yaw: this.#input.yaw, pitch: this.#input.pitch,
      pos: [this.#me.x, this.#me.y, this.#me.z], rtt: this.#clock.rtt, clockOffset: this.#clock.offset };
  }

  // SPEC 26: an SDK client for lobby reads on the actor transport; null on the Node dev server.
  lobbyClient() {
    const appId = import.meta.env?.VITE_BASE44_APP_ID;
    if (!appId) return null;
    this.#sdk ??= createClient({ appId, requiresAuth: false });
    return this.#sdk;
  }

  join(name, kit = this.#kit, roomId = roomIdFromLocation(window.location.search)) {
    this.#name = name;
    this.#kit = KITS[kit] ? kit : this.#kit;
    this.#roomId = roomId;
    this.#hud.setRoom(roomId);
    const handlers = {
      welcome: (m) => { this.#id = m.id; this.#pending = []; this.#lastHp = null; this.#hud.notice(''); this.#hud.show(); this.#pickups.setSpots(m.pickups); },
      pickup: (m) => this.#hud.killFeed(pickupText(m)),
      snap: (m) => this.#onSnapshot(m),
      shot: (m) => { this.#addTracer(m); if (m.id !== this.#id) this.#threat(m.from[0], m.from[2]); },
      verdict: (m) => this.#combat.verdict(m),
      boom: (m) => { this.#combat.boom(m, this.#id); this.#grenades.explode(m.at, performance.now()); this.#threat(m.at[0], m.at[2]); },
      kill: (m) => this.#hud.killFeed(`${m.killerName} eliminated ${m.victimName}`),
      matchEnd: (m) => this.#hud.matchEnd(m, this.#id), // SPEC 22
      matchStart: () => this.#hud.matchStart(),
      // SPEC 24 / 25 feedback lines
      ability: (m) => { if (m.id === this.#id && m.denied) this.#hud.abilityDenied(m.slot, m.denied); },
      xp: (m) => { if (m.levelUp) this.#hud.killFeed(`Level ${m.lvl}: pick a perk (3 / 4)`); },
      perk: (m) => this.#hud.killFeed(`Perk: ${PERKS[m.id]?.name ?? m.id}`),
      pong: (m) => this.#clock.onPong(m, Date.now()),
      error: (m) => this.#hud.notice(m.reason === 'room_full' ? 'Room is full' : 'Server error'),
      close: () => { this.#id = null; this.#hud.notice('Disconnected. Reload to rejoin.'); },
      // Actor transport only: the room woke up without our seat, or the link went quiet.
      rejoin: () => { this.#id = null; this.#net.send({ t: 'join', name: this.#name, kit: this.#kit }); },
      stale: () => { if (this.#id !== null) this.#hud.notice('Connection unstable, reconnecting...'); },
    };
    // VITE_BASE44_APP_ID is set by the Base44 build environment (the app sandbox exports it; `base44 build`
    // derives it from BASE44_APP_ID); without it this is the Node/ws server.
    const appId = import.meta.env?.VITE_BASE44_APP_ID;
    this.#net = appId
      ? new ActorNetwork(handlers, { appId, roomId: this.#roomId, client: this.lobbyClient() })
      : new Network(handlers);
    this.#net.connect(name, this.#kit);
  }

  #onSnapshot(snap) {
    this.#remote.push(snap.players, this.#id);
    this.#grenades.sync(snap.nades ?? []);
    this.#pickups.sync(snap.items);
    this.#effects.sync(snap.fx, performance.now());
    this.#self = snap.self ?? null;
    this.#combat.setPlayers(snap.players);
    const mine = snap.players.find((p) => p.id === this.#id);
    if (!mine) return;

    this.#pending = this.#pending.filter((c) => c.seq > snap.ack);
    Object.assign(this.#me, {
      x: mine.x, y: mine.y, z: mine.z, vy: mine.vy, vx: 0, vz: 0,
      onGround: mine.g === 1, alive: mine.alive === 1,
      ...(typeof mine.h === 'number' ? { h: mine.h } : {}),
      // SPEC 24.2: the dash runs inside stepPlayer, so prediction needs its remaining time and direction
      dash: snap.self?.dash ?? 0, dashDx: snap.self?.dashDx ?? 0, dashDz: snap.self?.dashDz ?? 0,
    });
    if (this.#me.alive) for (const c of this.#pending) stepPlayer(this.#me, c);
    if (mine.w && WEAPONS[mine.w]) this.#weapon = WEAPONS[mine.w];
    this.#onDamage(mine);
    this.#hud.update(mine, snap.players, Date.now(), snap.match, snap.self);
  }

  // SPEC 19.1 damage direction: the server does not tell the victim who hit them, so a drop in our hp
  // is attributed to the newest remote shot origin or explosion point seen inside the attribution window.
  #threat(x, z) {
    const now = performance.now();
    this.#threats = pruneThreats(this.#threats, now);
    this.#threats.push({ x, z, at: now });
  }

  #onDamage(mine) {
    const prev = this.#lastHp;
    this.#lastHp = mine.hp;
    if (prev === null || mine.hp >= prev) return;
    const now = performance.now();
    this.#threats = pruneThreats(this.#threats, now);
    const from = attributeDamage(this.#threats, now);
    this.#hud.damageFrom(from ? calculateDamageAngle(mine, this.#input.yaw, from) : null);
  }

  #addTracer(m) {
    const { THREE, scene } = this.#gfx;
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...m.from), new THREE.Vector3(...m.to)]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    this.#tracers.push({ line, born: performance.now() });
  }

  #updateTracers(now) {
    this.#tracers = this.#tracers.filter((t) => {
      const age = now - t.born;
      if (age < TRACER_MS) { t.line.material.opacity = 1 - age / TRACER_MS; return true; }
      this.#gfx.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      return false;
    });
  }

  #simulate(dt, now) {
    this.#accumulator += dt;
    const outgoing = [];
    while (this.#accumulator >= INPUT_DT) {
      this.#accumulator -= INPUT_DT;
      const s = this.#input.sample();
      const cmd = { seq: ++this.#seq, fwd: s.fwd, right: s.right, jump: s.jump, sprint: s.sprint, crouch: s.crouch, yaw: this.#input.yaw, pitch: this.#input.pitch };
      if (this.#me.alive) stepPlayer(this.#me, cmd);
      this.#pending.push(cmd);
      outgoing.push(cmd);
    }
    if (this.#pending.length > MAX_PENDING) this.#pending.splice(0, this.#pending.length - MAX_PENDING);
    // SPEC 18.1: the stamp lets the room's ClockSource advance from client time when the runtime clock is frozen.
    if (outgoing.length) this.#net.send({ t: 'input', cmds: outgoing, ts: Date.now() });

    if (this.#input.firing && this.#input.locked) this.#tryFire(now);
    this.#recoverRecoil(dt);
  }

  #recoverRecoil(dt) {
    const k = Math.min(1, dt * 12);
    const dp = this.#recoil.pitch * k;
    const dy = this.#recoil.yaw * k;
    if (dp === 0 && dy === 0) return;
    this.#input.turn(-dy, -dp);
    this.#recoil.pitch -= dp;
    this.#recoil.yaw -= dy;
    if (Math.abs(this.#recoil.pitch) < 1e-4) this.#recoil.pitch = 0;
    if (Math.abs(this.#recoil.yaw) < 1e-4) this.#recoil.yaw = 0;
  }

  #tryFire(now) {
    if (!this.joined || !this.#me.alive || now - this.#lastShot < this.#weapon.fireIntervalMs) return false;
    this.#lastShot = now;
    this.#net.send({ t: 'shoot' });
    this.#hud.onFire();
    // SPEC 20: recoil is cosmetic. The kick moves the aim; the recovery below pulls most of it back.
    const w = this.#weapon;
    const yawKick = (Math.random() - 0.5) * 2 * w.recoilYaw;
    this.#input.turn(yawKick, w.recoilPitch);
    this.#recoil.pitch += w.recoilPitch * 0.7;
    this.#recoil.yaw += yawKick * 0.7;
    return true;
  }

  #countFrame(now) {
    this.#fps.frames += 1;
    const elapsed = now - this.#fps.since;
    if (elapsed < 500) return;
    const el = document.getElementById('fps');
    const fps = `${Math.round((this.#fps.frames * 1000) / elapsed)} FPS`;
    const rtt = this.#clock.stats().rtt;
    if (el) el.textContent = rtt === null ? fps : `${fps} · ${rtt} ms`;
    this.#fps.frames = 0;
    this.#fps.since = now;
  }

  #frame(now) {
    requestAnimationFrame((t) => this.#frame(t));
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000); // clamp: a background tab must not flood the server
    this.#lastFrame = now;
    if (this.#fps.on) this.#countFrame(now);
    if (this.joined) {
      this.#simulate(dt, now);
      const ping = this.#clock.nextPing(Date.now());
      if (ping) this.#net.send(ping);
    }

    this.#remote.update(now);
    this.#updateTracers(now);
    this.#grenades.update(now);
    this.#pickups.update(now);
    const { camera, renderer, scene } = this.#gfx;
    // SPEC 23: the eye follows the crouch height; smoothed so a slide does not snap the camera
    const eyeTarget = this.#me.y + eyeOf(this.#me);
    this.#eyeY = this.#eyeY === null ? eyeTarget : this.#eyeY + (eyeTarget - this.#eyeY) * Math.min(1, dt * 14);
    camera.position.set(this.#me.x, this.#eyeY, this.#me.z);
    camera.rotation.set(this.#input.pitch, this.#input.yaw, 0);
    renderer.render(scene, camera);
  }
}
