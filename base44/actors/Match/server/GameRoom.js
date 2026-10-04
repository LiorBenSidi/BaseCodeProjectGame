// Authoritative game simulation for one room. No sockets, no timers, no clock of its own:
// callers inject `now`/`random` and drive `tick()`. That keeps it deterministic and testable,
// and means the same class can later run many rooms in one process.
//
// Trust model: this class assumes commands were already validated by protocol.js, but it still
// enforces the rules that matter for fairness (replay protection, command budget, fire rate).

import { TICK_RATE, MAX_PLAYERS, MAX_HP, RESPAWN_MS, PLAYER } from '../shared/constants.js';
import { MAPS, mapForMatch, describeMap } from '../shared/maps.js'; // SPEC 28: one map per match
import { stepPlayer, eyeOf, heightOf } from '../shared/movement.js';
import { aimDir } from '../shared/hitscan.js';
import { applyDamage, resolveShot } from '../shared/combat.js';
import { GRENADE } from '../shared/combatData.js';
// SPEC 20 weapons: table, loadout state machine, server-side spread.
import { newLoadout, activeWeapon, weaponDef, fireBlock, recordShot, decaySpread, startReload, finishReloadIfDue, switchSlot, spreadDir, isReloading } from '../shared/weapons.js';
import { blastDamage, launchGrenade, stepGrenade } from '../shared/projectile.js';
import { sanitizeName } from './security.js';
// SPEC 21: pickups, safest spawn, spawn protection.
import { buildPickups, stepPickups, availableIndices, describePickups } from '../shared/pickups.js';
import { pickSpawn } from '../shared/spawning.js';
import { SPAWN } from '../shared/rules.js';
// SPEC 24 / 25: kits, abilities, effects and in-match progression.
import { DEFAULT_KIT, KIT_IDS, isKit, newKitState, useAbility, stepEffects, applyGrapple, slowFactor, shieldBoxes, decoyTargets, describeEffects, cooldownLeft } from '../shared/abilities.js';
import { newProgress, grantXp, pickPerk, recordDamage, assistsFor, progressSnapshot, XP } from '../shared/progression.js';
// SPEC 22: match modes (DM / TDM), timer, end screen, restart.
import { DEFAULT_MODE, newMatch, startMatch, assignTeam, sameTeam, scoreKill, endReason, endMatch, shouldRestart, matchSnapshot } from '../shared/modes.js';

export const MAX_CMDS_PER_TICK = 4; // 60 Hz client cmds at a 30 Hz tick = 2 on average; 4 absorbs jitter
export const MAX_QUEUE = 12; // beyond this a client is flooding or speed-hacking: oldest cmds are dropped

const round3 = (v) => Math.round(v * 1000) / 1000;
const TICK_MS = 1000 / TICK_RATE;

export class GameRoom {
  #players = new Map();
  #nextId = 1;
  #tick = 0;
  #grenades = [];
  #nextGrenadeId = 1;
  #map = MAPS[mapForMatch(1)];
  #pickups = buildPickups(this.#map.pickups);
  #fx = []; // SPEC 24 active effects: shields, decoys, heal zones, stasis fields
  #nextFxId = 1;
  #now;
  #random;
  #log;
  #maxPlayers;
  #match;

  // SPEC 26 / 27: `hooks.roster({ players, maxPlayers, phase, matchNumber })` fires on join, leave and
  // match start / end; `hooks.matchEnd({ result, players })` fires after the matchEnd broadcast. Both are
  // persistence paths (never per tick); a hook that throws is logged and ignored.
  #hooks;

  constructor({ now = () => Date.now(), random = Math.random, logger = null, maxPlayers = MAX_PLAYERS, mode = DEFAULT_MODE, hooks = null } = {}) {
    this.#now = now;
    this.#hooks = hooks;
    this.#random = random;
    this.#log = logger;
    this.#maxPlayers = maxPlayers;
    this.#match = newMatch(mode); // throws RangeError on an unknown mode, before any player can join
  }

  get mode() {
    return this.#match.mode;
  }

  // Read-only view for lobbies and tests: { mode, phase, left, ts }.
  get matchState() {
    return matchSnapshot(this.#match, this.#now());
  }

  get playerCount() {
    return this.#players.size;
  }

  addPlayer({ send, name, kit, userId = null } = {}) {
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
      respawnAt: 0,
      // SPEC 20: two slots, one in hand; reload and switch arrive as intents and apply on the next tick
      loadout: newLoadout(),
      wantsReload: false,
      wantsSwitch: null,
      protectedUntil: -Infinity, // SPEC 21.2: set on respawn only; the first spawn is already the safest spot
      team: assignTeam(this.#match, this.#players.values()), // SPEC 22: -1 in DM, 0 Blue / 1 Red in TDM
      // SPEC 24: kit and cooldowns; a kit change applies on the next spawn. SPEC 25: XP, level, perks.
      userId: typeof userId === 'string' && userId.length > 0 && userId.length <= 64 ? userId : null, // SPEC 27: platform-verified, never from the payload
      kitState: newKitState(isKit(kit) ? kit : DEFAULT_KIT),
      nextKit: null,
      wantsAbility: null,
      wantsPerk: null,
      grapple: null,
      scannedUntil: -Infinity,
      dash: 0, dashDx: 0, dashDz: 0,
      progress: newProgress(),
    };
    this.#place(p);
    this.#players.set(id, p);
    this.#sendTo(p, { t: 'welcome', id, tickRate: TICK_RATE, pickups: describePickups(this.#pickups), map: describeMap(this.#map), mode: this.#match.mode, team: p.team, kit: p.kitState.kit });
    if (this.#match.phase === 'waiting') this.#startMatch(this.#now());
    this.#log?.info('player joined', { id, players: this.#players.size });
    this.#roster();
    return p;
  }

  removePlayer(id) {
    const removed = this.#players.delete(id);
    if (removed) this.#log?.info('player left', { id, players: this.#players.size });
    if (removed && this.#players.size === 0) this.#match = newMatch(this.#match.mode); // SPEC 22: an empty room waits
    if (removed) this.#roster();
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

  // SPEC 20.3: { t: 'reload' } and { t: 'switch', slot }. Validated upstream; the state machine re-checks.
  handleReload(id) {
    const p = this.#players.get(id);
    if (p) p.wantsReload = true;
  }

  handleSwitch(id, slot) {
    const p = this.#players.get(id);
    if (p) p.wantsSwitch = slot;
  }

  // SPEC 24.1: { t: 'ability', slot }, { t: 'kit', id } (next spawn), SPEC 25.3: { t: 'perk', id }.
  handleAbility(id, slot) {
    const p = this.#players.get(id);
    if (p && (slot === 0 || slot === 1)) p.wantsAbility = slot;
  }

  handleKit(id, kitId) {
    const p = this.#players.get(id);
    if (p && isKit(kitId)) p.nextKit = kitId;
  }

  handlePerk(id, perkId) {
    const p = this.#players.get(id);
    if (p) p.wantsPerk = String(perkId);
  }

  tick() {
    this.#tick += 1;
    const now = this.#now();

    for (const p of this.#players.values()) this.#runCommands(p);
    this.#stepAbilities(now);
    for (const p of this.#players.values()) this.#stepWeapons(p, now);
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
    stepEffects(this.#fx, this.#players.values(), now, TICK_MS, this.#map.boxes);
    for (const p of this.#players.values()) {
      if (!p.alive && now >= p.respawnAt) this.#respawn(p, now);
    }
    this.#stepMatch(now);
    for (const got of stepPickups(this.#pickups, this.#players.values(), now)) {
      const taker = this.#players.get(got.playerId);
      this.#sendTo(taker, { t: 'pickup', i: got.i, kind: got.kind, amount: got.amount, ...(got.weapon ? { weapon: got.weapon } : {}) });
    }
    this.#broadcastSnapshot(now);
  }

  // ---- internals -------------------------------------------------------------------------

  #runCommands(p) {
    const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
    // SPEC 24.4: an enemy stasis field scales the movement input; the client reconciles to the server's result.
    const slow = p.alive ? slowFactor(this.#fx, p) : 1;
    for (let i = 0; i < n; i++) {
      const raw = p.queue.shift();
      const cmd = slow < 1 ? { ...raw, fwd: raw.fwd * slow, right: raw.right * slow, sprint: false } : raw;
      if (p.alive && p.grapple) applyGrapple(p, cmd.jump, this.#now());
      if (p.alive) stepPlayer(p, cmd, this.#map.boxes, this.#map.half);
      p.yaw = cmd.yaw;
      p.pitch = cmd.pitch;
      p.lastSeq = cmd.seq;
    }
  }

  // SPEC 24: ability, kit and perk intents apply here, once per tick, before weapons and movement.
  #stepAbilities(now) {
    for (const p of this.#players.values()) {
      if (p.wantsPerk !== null) {
        const perk = pickPerk(p.progress, p.wantsPerk);
        p.wantsPerk = null;
        if (perk) this.#sendTo(p, { t: 'perk', id: perk.id, perks: p.progress.perks });
      }
      if (p.wantsAbility === null) continue;
      const slot = p.wantsAbility;
      p.wantsAbility = null;
      if (this.#match.phase !== 'playing') continue;
      const others = [...this.#players.values()];
      const r = useAbility(p, slot, { nowMs: now, boxes: this.#map.boxes, half: this.#map.half, players: others, fx: this.#fx, nextFxId: () => this.#nextFxId++, cdMul: p.progress.mods.cdMul });
      if (r.ok) this.#broadcast({ t: 'ability', id: p.id, ability: r.ability, slot, cd: r.cooldownMs });
      else this.#sendTo(p, { t: 'ability', id: p.id, slot, denied: r.reason });
    }
  }

  // SPEC 25.1: XP for damage, kills and assists; a level-up may open a perk offer.
  #award(p, amount) {
    if (amount <= 0) return;
    const { leveled } = grantXp(p.progress, amount, this.#random);
    this.#sendTo(p, { t: 'xp', amount, xp: p.progress.xp, lvl: p.progress.level, ...(leveled ? { levelUp: true } : {}), offer: p.progress.offer });
  }

  // SPEC 20: reload and switch intents apply here, reload timers complete, spread decays. Dead players keep
  // their state frozen; the respawn hands out a fresh loadout anyway.
  #stepWeapons(p, now) {
    const lo = p.loadout;
    if (p.wantsSwitch !== null) {
      if (p.alive) {
        switchSlot(lo, p.wantsSwitch, now);
        if (lo.switchingUntil > now) lo.switchingUntil = now + Math.round((lo.switchingUntil - now) * p.progress.mods.switchMul); // SPEC 25.2 Quick Draw
      }
      p.wantsSwitch = null;
    }
    if (p.wantsReload) {
      if (p.alive) {
        const before = activeWeapon(lo).reloadingUntil;
        startReload(lo, now);
        const ws = activeWeapon(lo);
        if (ws.reloadingUntil !== before && ws.reloadingUntil > now) ws.reloadingUntil = now + Math.round((ws.reloadingUntil - now) * p.progress.mods.reloadMul); // SPEC 25.2 Fast Hands
      }
      p.wantsReload = false;
    }
    finishReloadIfDue(lo.primary, now);
    finishReloadIfDue(lo.sidearm, now);
    decaySpread(lo.primary, TICK_MS);
    decaySpread(lo.sidearm, TICK_MS);
  }

  // SPEC 22: the match ends on time or score, shows the end screen for ENDING_MS, then restarts.
  #stepMatch(now) {
    const reason = endReason(this.#match, this.#players.values(), now);
    if (reason !== null) {
      const result = endMatch(this.#match, this.#players.values(), now, reason);
      const roster = [...this.#players.values()];
      this.#log?.info('match end', { reason, number: result.number });
      this.#broadcast({ t: 'matchEnd', ...result });
      this.#hook('matchEnd', { result, players: roster, mode: this.#match.mode, nowMs: now });
      this.#roster();
      return;
    }
    if (shouldRestart(this.#match, now)) {
      this.#switchMap(this.#match.number + 1); // SPEC 28: before respawns, so they land on the new map
      for (const p of this.#players.values()) {
        p.kills = 0;
        p.deaths = 0;
        p.respawnAt = 0;
        p.progress = newProgress(); // SPEC 25: progression is per match
        p.kitState = newKitState(p.nextKit ?? p.kitState.kit);
        p.nextKit = null;
        this.#respawn(p, now);
        p.protectedUntil = -Infinity;
      }
      this.#startMatch(now);
    }
  }

  // SPEC 28: the map rotates with the match number; pickups and grenades are rebuilt for it.
  #switchMap(matchNumber) {
    const next = MAPS[mapForMatch(matchNumber)];
    if (next === this.#map) return;
    this.#map = next;
    this.#pickups = buildPickups(this.#map.pickups);
    this.#grenades = [];
  }

  #roster() {
    this.#hook('roster', { players: this.#players.size, maxPlayers: this.#maxPlayers, phase: this.#match.phase, matchNumber: this.#match.number, nowMs: this.#now() });
  }

  #hook(name, info) {
    const fn = this.#hooks?.[name];
    if (typeof fn !== 'function') return;
    try {
      fn(info);
    } catch (err) {
      this.#log?.warn('hook failed', { hook: name, error: err?.message });
    }
  }

  #startMatch(now) {
    this.#fx = []; // SPEC 24: no effects carry over
    startMatch(this.#match, now);
    this.#switchMap(this.#match.number);
    this.#log?.info('match start', { mode: this.#match.mode, number: this.#match.number });
    this.#broadcast({ t: 'matchStart', ...matchSnapshot(this.#match, now), number: this.#match.number, map: describeMap(this.#map), pickups: describePickups(this.#pickups) });
    this.#roster();
  }

  #fire(p, now) {
    if (!p.alive || this.#match.phase !== 'playing' || fireBlock(p.loadout, now) !== null) return;
    const ws = activeWeapon(p.loadout);
    const weapon = weaponDef(ws.id);
    const spread = ws.spread;
    recordShot(ws, now);
    p.protectedUntil = -Infinity; // SPEC 21.2: shooting ends spawn protection

    const origin = [p.x, p.y + eyeOf(p), p.z];
    const aim = aimDir(p.yaw, p.pitch);
    const targets = [];
    for (const q of this.#players.values()) if (q !== p && q.alive) targets.push({ id: q.id, p: q });
    for (const d of decoyTargets(this.#fx)) if (d.fx.owner !== p.id) targets.push(d); // SPEC 24.3 decoys soak bullets
    const boxes = this.#fx.length ? this.#map.boxes.concat(shieldBoxes(this.#fx)) : this.#map.boxes; // SPEC 24.3 shields block

    // One ray per pellet, each with its own spread sample; damage is summed per victim and applied once.
    const perVictim = new Map();
    let first = null;
    for (let i = 0; i < weapon.pellets; i++) {
      const dir = spreadDir(aim, spread, this.#random);
      const shot = resolveShot(origin, dir, weapon, boxes, targets);
      const to = [origin[0] + dir[0] * shot.t, origin[1] + dir[1] * shot.t, origin[2] + dir[2] * shot.t];
      this.#broadcast({ t: 'shot', id: p.id, w: weapon.id, from: origin, to });
      if (first === null) first = shot;
      if (shot.targetId === null) continue;
      const acc = perVictim.get(shot.targetId) || { zone: shot.zone, dist: shot.dist, damage: 0 };
      acc.damage += shot.damage;
      perVictim.set(shot.targetId, acc);
    }

    if (perVictim.size === 0) {
      this.#sendTo(p, { t: 'verdict', target: null, zone: null, dmg: 0, dist: first.dist, kill: false });
      return;
    }
    let best = null;
    const killed = [];
    for (const [id, acc] of perVictim) {
      if (id < 0) {
        // SPEC 24.3: a decoy took the pellets; it dies on any damage, the shooter learns nothing but a hit marker
        const f = this.#fx.find((e) => e.kind === 'decoy' && -e.id === id);
        if (f) f.hp = 0;
        this.#sendTo(p, { t: 'hit', id });
        if (best === null) best = { victim: { id }, zone: acc.zone, dist: acc.dist, applied: 0, kill: false };
        continue;
      }
      const victim = this.#players.get(id);
      const r = this.#protected(victim, now) || sameTeam(p, victim) ? { applied: 0, killed: false } : applyDamage(victim, acc.damage * victim.progress.mods.dmgTakenMul);
      this.#award(p, recordDamage(p.progress, victim.progress, p.id, victim.id, r.applied, now));
      this.#sendTo(p, { t: 'hit', id: victim.id });
      if (r.killed) killed.push(victim);
      if (best === null || r.applied > best.applied) best = { victim, zone: acc.zone, dist: acc.dist, applied: r.applied, kill: r.killed };
    }
    this.#sendTo(p, { t: 'verdict', target: best.victim.id, zone: best.zone, dmg: best.applied, dist: best.dist, kill: best.kill });
    for (const v of killed) this.#kill(p.id, p.name, v, now);
  }

  #throw(p) {
    if (!p.alive || p.grenades <= 0 || this.#match.phase !== 'playing') return;
    p.grenades -= 1;
    const g = launchGrenade(this.#nextGrenadeId++, p.id, [p.x, p.y + eyeOf(p), p.z], aimDir(p.yaw, p.pitch));
    g.ownerName = p.name;
    this.#grenades.push(g);
  }

  #stepGrenades(now) {
    const boxes = this.#fx.length ? this.#map.boxes.concat(shieldBoxes(this.#fx)) : this.#map.boxes; // SPEC 24.3 grenades bounce off shields
    for (const g of this.#grenades) stepGrenade(g, 1 / TICK_RATE, boxes, this.#map.half);
    const exploded = this.#grenades.filter((g) => g.exploded);
    if (exploded.length === 0) return;
    this.#grenades = this.#grenades.filter((g) => !g.exploded);
    for (const g of exploded) {
      const at = [g.x, g.y, g.z];
      const hits = [];
      const victims = [];
      for (const q of this.#players.values()) {
        if (!q.alive || this.#protected(q, now)) continue;
        const owner = this.#players.get(g.owner);
        if (owner && owner !== q && sameTeam(owner, q)) continue; // SPEC 22: no friendly fire; your own grenade still hurts you
        const { applied, killed } = applyDamage(q, blastDamage(at, q, boxes) * q.progress.mods.dmgTakenMul);
        if (applied <= 0) continue;
        if (owner && owner !== q) this.#award(owner, recordDamage(owner.progress, q.progress, owner.id, q.id, applied, now));
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
    scoreKill(this.#match, killer, victim);
    // SPEC 25.1: kill and assist XP
    if (killer && killer !== victim) this.#award(killer, XP.kill);
    for (const aid of assistsFor(victim.progress, killerId, now)) {
      const a = this.#players.get(aid);
      if (a && a !== victim && !(a.team >= 0 && a.team === victim.team)) this.#award(a, XP.assist);
    }
    victim.grapple = null;
    victim.dash = 0;
    this.#log?.info('kill', { killer: killerId, victim: victim.id });
    this.#broadcast({ t: 'kill', killer: killerId, victim: victim.id, killerName, victimName: victim.name });
  }

  #protected(p, now) {
    return now < p.protectedUntil;
  }

  #respawn(p, now) {
    this.#place(p);
    p.protectedUntil = now + SPAWN.protectMs;
    p.hp = MAX_HP;
    p.alive = true;
    p.grenades = GRENADE.perLife + p.progress.mods.grenades; // SPEC 25.2 Grenadier
    p.loadout = newLoadout();
    if (p.nextKit) { p.kitState = newKitState(p.nextKit); p.nextKit = null; } // SPEC 24.1 kit change on spawn
    p.grapple = null;
    p.dash = 0;
    p.scannedUntil = -Infinity;
    p.wantsReload = false;
    p.wantsSwitch = null;
  }

  #place(p) {
    const enemies = [];
    for (const q of this.#players.values()) if (q !== p) enemies.push(q);
    const s = pickSpawn(this.#map.spawns, enemies, this.#random);
    p.x = s.x; p.y = 0; p.z = s.z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.onGround = true;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.h = PLAYER.height; // SPEC 23: stand up on (re)spawn
    p.slide = 0;
    p.wallJumps = PLAYER.wallJumpsPerAir;
  }

  #broadcastSnapshot(now) {
    const players = [];
    for (const p of this.#players.values()) {
      const ws = activeWeapon(p.loadout);
      players.push({
        id: p.id, name: p.name,
        x: round3(p.x), y: round3(p.y), z: round3(p.z), vy: round3(p.vy),
        g: p.onGround ? 1 : 0,
        h: round3(heightOf(p)), // SPEC 23: current hitbox height (crouch, slide)
        yaw: round3(p.yaw), pitch: round3(p.pitch),
        hp: p.hp, alive: p.alive ? 1 : 0, k: p.kills, d: p.deaths,
        // SPEC 20.4: weapon in hand, magazine, reserve, reloading flag (public: a scoreboard-sized leak at most)
        w: ws.id, m: ws.mag, r: ws.reserve, rel: isReloading(ws, now) ? 1 : 0,
        sp: this.#protected(p, now) ? 1 : 0, // SPEC 21.2 spawn protection
        tm: p.team, // SPEC 22: -1 in DM, 0 / 1 in TDM
        kt: KIT_IDS.indexOf(p.kitState.kit), lv: p.progress.level, // SPEC 24 / 25: kit index into KIT_IDS, level
        sc: now < p.scannedUntil ? 1 : 0, // SPEC 24.3 revealed by a scan
      });
    }
    const nades = this.#grenades.map((g) => ({ id: g.id, x: round3(g.x), y: round3(g.y), z: round3(g.z) }));
    const items = availableIndices(this.#pickups, now);
    const match = matchSnapshot(this.#match, now);
    const fx = describeEffects(this.#fx, now);
    for (const p of this.#players.values()) {
      // SPEC 24.5: the recipient's private block: cooldowns, dash state for prediction, progression
      const self = { cd: [cooldownLeft(p.kitState, 0, now), cooldownLeft(p.kitState, 1, now)], kit: p.kitState.kit, ...(p.dash > 0 ? { dash: round3(p.dash), dashDx: round3(p.dashDx), dashDz: round3(p.dashDz) } : {}), ...(p.grapple ? { grapple: 1 } : {}), ...progressSnapshot(p.progress) };
      this.#sendTo(p, { t: 'snap', tick: this.#tick, ack: p.lastSeq, players, nades, items, match, fx, self });
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
