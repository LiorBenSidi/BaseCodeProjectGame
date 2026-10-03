import { INPUT_DT, PLAYER, WEAPON } from '../shared/constants.js';
import { stepPlayer } from '../shared/movement.js';
import { CombatHud } from './combatHud.js';
import { Grenades } from './grenades.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Network } from './net.js';
import { RemotePlayers } from './remote.js';
import { createScene } from './scene.js';

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
  #me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, alive: false };
  #id = null;
  #seq = 0;
  #pending = [];
  #accumulator = 0;
  #lastFrame = performance.now();
  #lastShot = 0;
  #tracers = [];

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
    this.#net = new Network({
      welcome: (m) => { this.#id = m.id; this.#hud.show(); },
      snap: (m) => this.#onSnapshot(m),
      shot: (m) => this.#addTracer(m),
      verdict: (m) => this.#combat.verdict(m),
      boom: (m) => { this.#combat.boom(m, this.#id); this.#grenades.explode(m.at, performance.now()); },
      kill: (m) => this.#hud.killFeed(`${m.killerName} eliminated ${m.victimName}`),
      error: (m) => this.#hud.notice(m.reason === 'room_full' ? 'Room is full' : 'Server error'),
      close: () => { this.#id = null; this.#hud.notice('Disconnected. Reload to rejoin.'); },
    });
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
    this.#hud.update(mine, snap.players);
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
    if (outgoing.length) this.#net.send({ t: 'input', cmds: outgoing });

    if (this.#input.firing && this.#input.locked) this.#tryFire(now);
  }

  #tryFire(now) {
    if (!this.joined || !this.#me.alive || now - this.#lastShot < WEAPON.cooldownMs) return false;
    this.#lastShot = now;
    this.#net.send({ t: 'shoot' });
    return true;
  }

  #frame(now) {
    requestAnimationFrame((t) => this.#frame(t));
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000); // clamp: a background tab must not flood the server
    this.#lastFrame = now;
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
