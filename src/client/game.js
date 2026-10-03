import { INPUT_DT, PLAYER, WEAPON } from '../shared/constants.js';
import { stepPlayer } from '../shared/movement.js';
import { CombatHud } from './combatHud.js';
import { Grenades } from './grenades.js';
import { Hud } from './hud.js';
import { attributeDamage, calculateDamageAngle, pruneThreats } from './hudModel.js';
import { Input } from './input.js';
import { Network } from './net.js';
import { ActorNetwork, roomIdFromLocation } from './netActor.js';
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
  #lastShot = 0;
  #tracers = [];
  #threats = [];
  #lastHp = null;

  constructor(canvas) {
    this.#gfx = createScene(canvas);
    this.#input = new Input(canvas);
    this.#remote = new RemotePlayers(this.#gfx.scene);
    this.#grenades = new Grenades(this.#gfx.scene);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.#hud.setScoreboardVisible(true); }
      if (e.code === 'KeyG' && !e.repeat && this.#input.locked) this.throwGrenade();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.#hud.setScoreboardVisible(false);
    });
    this.#touch = new TouchControls(this.#input, {
      grenade: () => this.throwGrenade(),
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

  throwGrenade() {
    if (!this.joined || !this.#me.alive) return false;
    this.#net.send({ t: 'throw' });
    return true;
  }

  debugState() {
    return { joined: this.joined, id: this.#id, alive: this.#me.alive, yaw: this.#input.yaw, pitch: this.#input.pitch,
      pos: [this.#me.x, this.#me.y, this.#me.z] };
  }

  join(name) {
    this.#name = name;
    const handlers = {
      welcome: (m) => { this.#id = m.id; this.#pending = []; this.#lastHp = null; this.#hud.notice(''); this.#hud.show(); },
      snap: (m) => this.#onSnapshot(m),
      shot: (m) => { this.#addTracer(m); if (m.id !== this.#id) this.#threat(m.from[0], m.from[2]); },
      verdict: (m) => this.#combat.verdict(m),
      boom: (m) => { this.#combat.boom(m, this.#id); this.#grenades.explode(m.at, performance.now()); this.#threat(m.at[0], m.at[2]); },
      kill: (m) => this.#hud.killFeed(`${m.killerName} eliminated ${m.victimName}`),
      error: (m) => this.#hud.notice(m.reason === 'room_full' ? 'Room is full' : 'Server error'),
      close: () => { this.#id = null; this.#hud.notice('Disconnected. Reload to rejoin.'); },
      // Actor transport only: the room woke up without our seat, or the link went quiet.
      rejoin: () => { this.#id = null; this.#net.send({ t: 'join', name: this.#name }); },
      stale: () => { if (this.#id !== null) this.#hud.notice('Connection unstable, reconnecting...'); },
    };
    // VITE_BASE44_APP_ID is set by the Base44 build environment (the app sandbox exports it; `base44 build`
    // derives it from BASE44_APP_ID); without it this is the Node/ws server.
    const appId = import.meta.env?.VITE_BASE44_APP_ID;
    this.#net = appId
      ? new ActorNetwork(handlers, { appId, roomId: roomIdFromLocation(window.location.search) })
      : new Network(handlers);
    this.#net.connect(name);
  }

  #onSnapshot(snap) {
    this.#remote.push(snap.players, this.#id);
    this.#grenades.sync(snap.nades ?? []);
    this.#combat.setPlayers(snap.players);
    const mine = snap.players.find((p) => p.id === this.#id);
    if (!mine) return;

    this.#pending = this.#pending.filter((c) => c.seq > snap.ack);
    Object.assign(this.#me, {
      x: mine.x, y: mine.y, z: mine.z, vy: mine.vy, vx: 0, vz: 0,
      onGround: mine.g === 1, alive: mine.alive === 1,
    });
    if (this.#me.alive) for (const c of this.#pending) stepPlayer(this.#me, c);
    this.#onDamage(mine);
    this.#hud.update(mine, snap.players);
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
      const cmd = { seq: ++this.#seq, fwd: s.fwd, right: s.right, jump: s.jump, yaw: this.#input.yaw, pitch: this.#input.pitch };
      if (this.#me.alive) stepPlayer(this.#me, cmd);
      this.#pending.push(cmd);
      outgoing.push(cmd);
    }
    if (this.#pending.length > MAX_PENDING) this.#pending.splice(0, this.#pending.length - MAX_PENDING);
    // SPEC 18.1: the stamp lets the room's ClockSource advance from client time when the runtime clock is frozen.
    if (outgoing.length) this.#net.send({ t: 'input', cmds: outgoing, ts: Date.now() });

    if (this.#input.firing && this.#input.locked) this.#tryFire(now);
  }

  #tryFire(now) {
    if (!this.joined || !this.#me.alive || now - this.#lastShot < WEAPON.cooldownMs) return false;
    this.#lastShot = now;
    this.#net.send({ t: 'shoot' });
    this.#hud.onFire();
    return true;
  }

  #countFrame(now) {
    this.#fps.frames += 1;
    const elapsed = now - this.#fps.since;
    if (elapsed < 500) return;
    const el = document.getElementById('fps');
    if (el) el.textContent = `${Math.round((this.#fps.frames * 1000) / elapsed)} FPS`;
    this.#fps.frames = 0;
    this.#fps.since = now;
  }

  #frame(now) {
    requestAnimationFrame((t) => this.#frame(t));
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000); // clamp: a background tab must not flood the server
    this.#lastFrame = now;
    if (this.#fps.on) this.#countFrame(now);
    if (this.joined) this.#simulate(dt, now);

    this.#remote.update(now);
    this.#updateTracers(now);
    this.#grenades.update(now);
    const { camera, renderer, scene } = this.#gfx;
    camera.position.set(this.#me.x, this.#me.y + PLAYER.eye, this.#me.z);
    camera.rotation.set(this.#input.pitch, this.#input.yaw, 0);
    renderer.render(scene, camera);
  }
}
