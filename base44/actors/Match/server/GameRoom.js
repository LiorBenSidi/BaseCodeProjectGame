// Authoritative game simulation for one room. No sockets, no timers, no clock of its own:
// callers inject `now`/`random` and drive `tick()`. That keeps it deterministic and testable,
// and means the same class can later run many rooms in one process.
//
// Trust model: this class assumes commands were already validated by protocol.js, but it still
// enforces the rules that matter for fairness (replay protection, command budget, fire rate).

import { TICK_RATE, MAX_PLAYERS, MAX_HP, RESPAWN_MS, PLAYER } from '../shared/constants.js';
import { MAP } from '../shared/map.js';
import { stepPlayer } from '../shared/movement.js';
import { aimDir } from '../shared/hitscan.js';
import { applyDamage, resolveShot } from '../shared/combat.js';
import { GRENADE, RIFLE } from '../shared/combatData.js';
import { blastDamage, launchGrenade, stepGrenade } from '../shared/projectile.js';
import { sanitizeName } from './security.js';

export const MAX_CMDS_PER_TICK = 4; // 60 Hz client cmds at a 30 Hz tick = 2 on average; 4 absorbs jitter
export const MAX_QUEUE = 12; // beyond this a client is flooding or speed-hacking: oldest cmds are dropped

const round3 = (v) => Math.round(v * 1000) / 1000;

export class GameRoom {
  #players = new Map();
  #nextId = 1;
  #tick = 0;
  #grenades = [];
  #nextGrenadeId = 1;
  #now;
  #random;
  #log;
  #maxPlayers;

  constructor({ now = () => Date.now(), random = Math.random, logger = null, maxPlayers = MAX_PLAYERS } = {}) {
    this.#now = now;
    this.#random = random;
    this.#log = logger;
    this.#maxPlayers = maxPlayers;
  }

  get playerCount() {
    return this.#players.size;
  }

  addPlayer({ send, name } = {}) {
    if (typeof send !== 'function') throw new TypeError('addPlayer requires a send(obj) function');
    if (this.#players.size >= this.#maxPlayers) return null;

    const id = this.#nextId++;
    const p = {
      id,
      name: sanitizeName(name) || `Player${id}`,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      onGround: true,
      yaw: 0,
      pitch: 0,
      hp: MAX_HP,
      alive: true,
      kills: 0,
      deaths: 0,
      lastSeq: -1,
      // server-internal bookkeeping
      send,
      queue: [],
      lastQueuedSeq: -1,
      wantsShot: false,
      wantsThrow: false,
      grenades: GRENADE.perLife,
      lastShotAt: -Infinity,
      respawnAt: 0,
    };
    this.#place(p);
    this.#players.set(id, p);
    this.#sendTo(p, { t: 'welcome', id, tickRate: TICK_RATE });
    this.#log?.info('player joined', { id, players: this.#players.size });
    return p;
  }

  removePlayer(id) {
    const removed = this.#players.delete(id);
    if (removed) this.#log?.info('player left', { id, players: this.#players.size });
    return removed;
  }

  handleInput(id, cmds) {
    const p = this.#players.get(id);
    if (!p || !Array.isArray(cmds)) return;
    for (const c of cmds) {
      if (c.seq > p.lastQueuedSeq) {
        p.queue.push(c);
        p.lastQueuedSeq = c.seq;
      }
    }
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  handleShoot(id) {
    const p = this.#players.get(id);
    if (p) p.wantsShot = true;
  }

  handleThrow(id) {
    const p = this.#players.get(id);
    if (p) p.wantsThrow = true;
  }

  tick() {
    this.#tick += 1;
    const now = this.#now();

    for (const p of this.#players.values()) this.#runCommands(p);
    for (const p of this.#players.values()) {
      if (!p.wantsShot) continue;
      p.wantsShot = false;
      this.#fire(p, now);
    }
    for (const p of this.#players.values()) {
      if (!p.wantsThrow) continue;
      p.wantsThrow = false;
      this.#throw(p);
    }
    this.#stepGrenades(now);
    for (const p of this.#players.values()) {
      if (!p.alive && now >= p.respawnAt) this.#respawn(p);
    }
    this.#broadcastSnapshot();
  }

  // ---- internals -------------------------------------------------------------------------

  #runCommands(p) {
    const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
    for (let i = 0; i < n; i++) {
      const cmd = p.queue.shift();
      if (p.alive) stepPlayer(p, cmd);
      p.yaw = cmd.yaw;
      p.pitch = cmd.pitch;
      p.lastSeq = cmd.seq;
    }
  }

  #fire(p, now) {
    if (!p.alive || now - p.lastShotAt < RIFLE.cooldownMs) return;
    p.lastShotAt = now;

    const origin = [p.x, p.y + PLAYER.eye, p.z];
    const dir = aimDir(p.yaw, p.pitch);
    const targets = [];
    for (const q of this.#players.values()) if (q !== p && q.alive) targets.push({ id: q.id, p: q });
    const shot = resolveShot(origin, dir, RIFLE, MAP.boxes, targets);
    const to = [origin[0] + dir[0] * shot.t, origin[1] + dir[1] * shot.t, origin[2] + dir[2] * shot.t];
    this.#broadcast({ t: 'shot', id: p.id, from: origin, to });

    if (shot.targetId === null) {
      this.#sendTo(p, { t: 'verdict', target: null, zone: null, dmg: 0, dist: shot.dist, kill: false });
      return;
    }
    const victim = this.#players.get(shot.targetId);
    const { applied, killed } = applyDamage(victim, shot.damage);
    this.#sendTo(p, { t: 'hit', id: victim.id });
    this.#sendTo(p, { t: 'verdict', target: victim.id, zone: shot.zone, dmg: applied, dist: shot.dist, kill: killed });
    if (killed) this.#kill(p.id, p.name, victim, now);
  }

  #throw(p) {
    if (!p.alive || p.grenades <= 0) return;
    p.grenades -= 1;
    const g = launchGrenade(this.#nextGrenadeId++, p.id, [p.x, p.y + PLAYER.eye, p.z], aimDir(p.yaw, p.pitch));
    g.ownerName = p.name;
    this.#grenades.push(g);
  }

  #stepGrenades(now) {
    for (const g of this.#grenades) stepGrenade(g, 1 / TICK_RATE, MAP.boxes, MAP.half);
    const exploded = this.#grenades.filter((g) => g.exploded);
    if (exploded.length === 0) return;
    this.#grenades = this.#grenades.filter((g) => !g.exploded);
    for (const g of exploded) {
      const at = [g.x, g.y, g.z];
      const hits = [];
      const victims = [];
      for (const q of this.#players.values()) {
        if (!q.alive) continue;
        const { applied, killed } = applyDamage(q, blastDamage(at, q, MAP.boxes));
        if (applied <= 0) continue;
        hits.push({ id: q.id, dmg: applied, kill: killed });
        if (killed) victims.push(q);
      }
      this.#broadcast({ t: 'boom', id: g.id, owner: g.owner, at: at.map(round3), hits });
      for (const v of victims) this.#kill(g.owner, g.ownerName, v, now);
    }
  }

  // A self-kill (own grenade) counts a death and no kill. The killer may have left the room.
  #kill(killerId, killerName, victim, now) {
    victim.alive = false;
    victim.deaths += 1;
    victim.respawnAt = now + RESPAWN_MS;
    const killer = this.#players.get(killerId);
    if (killer && killer !== victim) killer.kills += 1;
    this.#log?.info('kill', { killer: killerId, victim: victim.id });
    this.#broadcast({ t: 'kill', killer: killerId, victim: victim.id, killerName, victimName: victim.name });
  }

  #respawn(p) {
    this.#place(p);
    p.hp = MAX_HP;
    p.alive = true;
    p.grenades = GRENADE.perLife;
  }

  #place(p) {
    const n = MAP.spawns.length;
    const s = MAP.spawns[Math.min(n - 1, Math.floor(this.#random() * n))];
    p.x = s.x; p.y = 0; p.z = s.z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.onGround = true;
    p.yaw = s.yaw;
    p.pitch = 0;
  }

  #broadcastSnapshot() {
    const players = [];
    for (const p of this.#players.values()) {
      players.push({
        id: p.id, name: p.name,
        x: round3(p.x), y: round3(p.y), z: round3(p.z), vy: round3(p.vy),
        g: p.onGround ? 1 : 0,
        yaw: round3(p.yaw), pitch: round3(p.pitch),
        hp: p.hp, alive: p.alive ? 1 : 0, k: p.kills, d: p.deaths,
      });
    }
    const nades = this.#grenades.map((g) => ({ id: g.id, x: round3(g.x), y: round3(g.y), z: round3(g.z) }));
    for (const p of this.#players.values()) {
      this.#sendTo(p, { t: 'snap', tick: this.#tick, ack: p.lastSeq, players, nades });
    }
  }

  #broadcast(msg) {
    for (const p of this.#players.values()) this.#sendTo(p, msg);
  }

  // A failing transport for one player (closed socket, throwing callback) must never
  // stop the simulation for everybody else.
  #sendTo(p, msg) {
    try {
      p.send(msg);
    } catch (err) {
      this.#log?.warn('send failed', { id: p.id, err });
    }
  }
}
