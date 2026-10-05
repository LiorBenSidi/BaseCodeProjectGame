// Authoritative game simulation for one room. No sockets, no timers, no clock of its own:
// callers inject `now`/`random` and drive `tick()`. That keeps it deterministic and testable,
// and means the same class can later run many rooms in one process.
//
// Trust model: this class assumes commands were already validated by protocol.js, but it still
// enforces the rules that matter for fairness (replay protection, command budget, fire rate).

import { TICK_RATE, MAX_PLAYERS, MAX_HP, RESPAWN_MS, PLAYER } from '../shared/constants.js';
import { MAPS, mapForMatch, describeMap } from '../shared/maps.js'; // SPEC 28: one map per match
import { newBrain, botStep, botName, botsWanted, seededRng, isDifficulty } from '../shared/bots.js'; // PRO-audio: SPEC 35.3 bots
import { sanitizeChat, chatAllowed, recordKill, resetStreak, streakEndedText } from '../shared/social.js'; // SPEC 29
import { stepPlayer, eyeOf, heightOf } from '../shared/movement.js';
import { aimDir } from '../shared/hitscan.js';
import { applyDamage, resolveShot } from '../shared/combat.js';
import { GRENADE } from '../shared/combatData.js';
// SPEC 20 weapons: table, loadout state machine, server-side spread.
import { newLoadout, activeWeapon, weaponDef, fireBlock, recordShot, decaySpread, startReload, finishReloadIfDue, switchSlot, spreadDir, isReloading, burstDue, cancelBurst, meleeStyle } from '../shared/weapons.js';
import { startMelee, stepMelee, meleeTargets, clashes, applyClash, knockback, isSwinging, snapshotMelee, MELEE_PHASE } from '../shared/melee.js'; // SPEC 38.3
import { blastDamage, launchGrenade, stepGrenade } from '../shared/projectile.js';
import { sanitizeName } from './security.js';
// SPEC 21: pickups, safest spawn, spawn protection.
import { buildPickups, stepPickups, availableIndices, describePickups } from '../shared/pickups.js';
import { pickSpawn } from '../shared/spawning.js';
import { SPAWN } from '../shared/rules.js';
import { radarActive, cmdIsActive, afkEligible, isAfk } from '../shared/presence.js';
import { isStationLevel, newStation, pickTargetSpot, stepStation, recordHit, stationSummary } from '../shared/rangeStation.js'; // SPEC 37.7 // P7: SPEC 37.1 radar pulse, 37.4 AFK
// SPEC 24 / 25: kits, abilities, effects and in-match progression.
import { DEFAULT_KIT, KIT_IDS, isKit, newKitState, useAbility, stepEffects, applyGrapple, slowFactor, shieldBoxes, decoyTargets, describeEffects, cooldownLeft } from '../shared/abilities.js';
import { newProgress, grantXp, pickPerk, recordDamage, assistsFor, progressSnapshot, XP } from '../shared/progression.js';
// SPEC 22: match modes (DM / TDM), timer, end screen, restart.
import { DEFAULT_MODE, newMatch, startMatch, assignTeam, sameTeam, scoreKill, endReason, endMatch, shouldRestart, matchSnapshot, updateIntroPhase, recordVote, tallyVotes, voteCandidatesFor, voteCounts } from '../shared/modes.js';
import { MAP_IDS } from '../shared/maps.js'; // PRO-ceremony: SPEC 34.4 vote candidates
import { armsKill, armsLoadoutIds, stageText } from '../shared/armsRace.js'; // SPEC 40.3
import { newHillState, stepHill, hillSnapshot, newFlagState, stepFlags, flagsSnapshot, carrying, flagEventText } from '../shared/objectives.js'; // SPEC 39
import { scoreObjective, TEAM_NAMES, modeDef } from '../shared/modes.js';
import { sanitizeMark, markAllowed } from '../shared/comms.js'; // SPEC 39.8
import { newMedalTracker, recordKillMedals, matchEndMedals } from '../shared/medals.js'; // PRO-ceremony: SPEC 34.3

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
  #objective = null; // SPEC 39: hill or flag state for the current match, null outside objective modes
  #pickups = buildPickups(this.#map.pickups); // rebuilt once the mode is known (SPEC 40.3: Arms Race has none)
  #fx = []; // SPEC 24 active effects: shields, decoys, heal zones, stasis fields
  #nextFxId = 1;
  #now;
  #random;
  #log;
  #maxPlayers;
  #match;
  #medals = newMedalTracker(); // PRO-ceremony: SPEC 34.3
  #nextMapId = null; // PRO-ceremony: SPEC 34.4 the voted map for the next match

  // SPEC 26 / 27: `hooks.roster({ players, maxPlayers, phase, matchNumber })` fires on join, leave and
  // match start / end; `hooks.matchEnd({ result, players })` fires after the matchEnd broadcast. Both are
  // persistence paths (never per tick); a hook that throws is logged and ignored.
  #hooks;

  // PRO-audio begin (SPEC 35.3): bots fill seats up to `botFill` while humans are present, and leave as humans arrive
  #bots = new Map(); // bot player id -> brain
  #botFill = 0;
  #botDifficulty = 'medium';
  #botRng = seededRng(1);
  #botSeed = 1;
  // PRO-audio end
  constructor({ now = () => Date.now(), random = Math.random, logger = null, maxPlayers = MAX_PLAYERS, mode = DEFAULT_MODE, hooks = null, botFill = 0, botDifficulty = 'medium', botSeed = 1 } = {}) {
    this.#botFill = Math.max(0, botFill | 0);
    this.#botDifficulty = isDifficulty(botDifficulty) ? botDifficulty : 'medium';
    this.#botSeed = botSeed;
    this.#botRng = seededRng(botSeed);
    this.#now = now;
    this.#hooks = hooks;
    this.#random = random;
    this.#log = logger;
    this.#maxPlayers = maxPlayers;
    this.#match = newMatch(mode); // throws RangeError on an unknown mode, before any player can join
    if (this.#match.arms) this.#pickups = buildPickups([]); // SPEC 40.3
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

  addPlayer({ send, name, kit, userId = null, bot = false } = {}) {
    if (typeof send !== 'function') throw new TypeError('addPlayer requires a send(obj) function');
    if (this.#players.size >= this.#maxPlayers) return null;

    const id = this.#nextId++;
    const p = {
      id,
      name: sanitizeName(name) || `Player${id}`,
      bot, // PRO-audio: SPEC 35.3
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
      loadout: newLoadout(), // SPEC 40.3: replaced by the stage weapon below once the team is known
      wantsReload: false,
      wantsSwitch: null,
      protectedUntil: -Infinity, // SPEC 21.2: set on respawn only; the first spawn is already the safest spot
      lastActiveAt: this.#now(), // SPEC 37.4: last command that did something (move, jump, turn); zero commands do not count
      afk: false, // SPEC 37.4: a bot brain drives the body while true
      afkBrain: null,
      humanYaw: 0, humanPitch: 0, // SPEC 37.4: the human's own last look, so a brain turning the body never counts as their activity
      team: assignTeam(this.#match, this.#players.values()), // SPEC 22: -1 in DM, 0 Blue / 1 Red in TDM
      // SPEC 24: kit and cooldowns; a kit change applies on the next spawn. SPEC 25: XP, level, perks.
      userId: typeof userId === 'string' && userId.length > 0 && userId.length <= 64 ? userId : null, // SPEC 27: platform-verified, never from the payload
      kitState: newKitState(isKit(kit) ? kit : DEFAULT_KIT),
      nextKit: null,
      wantsAbility: null,
      wantsMelee: false, melee: null, staggerUntil: -Infinity, // SPEC 38.3
      wantsPerk: null,
      grapple: null,
      scannedUntil: -Infinity,
      dash: 0, dashDx: 0, dashDz: 0,
      progress: newProgress(),
    };
    this.#place(p);
    if (this.#match.arms && p.team >= 0) p.loadout = newLoadout(armsLoadoutIds(this.#match.arms, p.team)); // SPEC 40.3
    this.#players.set(id, p);
    this.#sendTo(p, { t: 'welcome', id, tickRate: TICK_RATE, pickups: describePickups(this.#pickups), map: describeMap(this.#map), mode: this.#match.mode, team: p.team, kit: p.kitState.kit });
    if (this.#match.phase === 'waiting') this.#startMatch(this.#now());
    this.#log?.info('player joined', { id, players: this.#players.size });
    this.#balanceBots();
    this.#roster();
    return p;
  }

  // PRO-audio begin (SPEC 35.3)
  get humanCount() {
    let n = 0;
    for (const p of this.#players.values()) if (!p.bot) n += 1;
    return n;
  }

  get botCount() {
    return this.#bots.size;
  }

  // Adds one bot. Bots are ordinary players with `bot: true`; their messages go nowhere.
  addBot(difficulty = this.#botDifficulty) {
    const brain = newBrain(difficulty, this.#botSeed + this.#bots.size + this.#nextId);
    const taken = new Set([...this.#players.values()].map((p) => p.name));
    const p = this.addPlayer({ send: () => {}, name: botName(brain, taken), kit: undefined, userId: null, bot: true });
    if (!p) return null;
    this.#bots.set(p.id, brain);
    this.#log?.info('bot joined', { id: p.id, difficulty: brain.difficulty });
    return p;
  }

  removeBot(id) {
    if (!this.#bots.has(id)) return false;
    this.#bots.delete(id);
    return this.removePlayer(id);
  }

  // Keeps `botFill` seats filled while at least one human is in the room; an empty room has no bots.
  #balanceBots() {
    if (this.#balancing) return;
    this.#balancing = true;
    try {
      const humans = this.humanCount;
      const wanted = humans === 0 ? 0 : botsWanted(humans, this.#botFill, this.#maxPlayers);
      while (this.#bots.size > wanted) this.removeBot([...this.#bots.keys()].at(-1));
      while (this.#bots.size < wanted && this.#players.size < this.#maxPlayers) if (!this.addBot()) break;
    } finally { this.#balancing = false; }
  }
  #balancing = false;

  // Bots think before the commands run, so their input lands in the same tick as a human's.
  #stepBots(now) {
    if (this.#bots.size === 0) return;
    const all = [...this.#players.values()];
    for (const [id, brain] of this.#bots) {
      const bot = this.#players.get(id);
      if (!bot) { this.#bots.delete(id); continue; }
      if (bot.frozen) continue; // SPEC 37.7: the station target stands still
      const obj = this.#objective ? { ...this.#objectiveSnapshot(now), carrying: this.#objective.kind === 'flags' && !!carrying(this.#objective.state, id) } : null; // SPEC 39.5
      const r = botStep(brain, bot, all, this.#map, now, this.#botRng, sameTeam, obj);
      this.handleInput(id, [r.cmd]);
      if (r.reload) this.handleReload(id);
      if (r.shoot) this.handleShoot(id);
    }
  }

  // SPEC 37.4: a human idle for AFK.idleMs in dm or tdm is marked AFK and a bot brain takes the body over;
  // the first active command hands it back. The player keeps their seat, score and name.
  #stepAfk(now) {
    if (!afkEligible(this.#match.mode)) return;
    const all = this.#afkCount > 0 ? [...this.#players.values()] : null;
    for (const p of this.#players.values()) {
      if (p.bot) continue;
      if (!p.afk) {
        if (this.#match.phase === 'playing' && isAfk(p.lastActiveAt, now)) this.#setAfk(p, true);
        continue;
      }
      const r = botStep(p.afkBrain, p, all, this.#map, now, this.#botRng, sameTeam);
      this.handleInput(p.id, [r.cmd], true);
      if (r.reload) this.handleReload(p.id);
      if (r.shoot) this.handleShoot(p.id);
    }
  }

  #afkCount = 0;

  // SPEC 37.7: the Range reaction station. One per room (the range is a solo space in practice), range mode only.
  #station = null;
  handleStation(id, level) {
    const p = this.#players.get(id);
    if (!p || p.bot || this.#match.mode !== 'range') return false;
    if (level === null || !isStationLevel(level)) {
      if (this.#station?.ownerId === id) this.#endStation('off');
      return level === null;
    }
    if (this.#station && this.#station.ownerId !== id) return false; // somebody else is using it
    if (this.#station) this.#releaseTarget();
    this.#station = newStation(id, level, this.#now());
    this.#sendTo(p, { t: 'station', on: 1, ...stationSummary(this.#station) });
    this.#log?.info('station on', { id, level });
    return true;
  }
  #endStation(reason) {
    const st = this.#station;
    if (!st) return;
    this.#releaseTarget();
    this.#station = null;
    const owner = this.#players.get(st.ownerId);
    if (owner) this.#sendTo(owner, { t: 'station', on: 0, reason, ...stationSummary(st) });
  }
  #releaseTarget() {
    const st = this.#station;
    const bot = st?.targetId !== null ? this.#players.get(st.targetId) : null;
    if (bot) bot.frozen = false;
    if (st) st.targetId = null;
  }
  #stepStation(now) {
    const st = this.#station;
    if (!st) return;
    const owner = this.#players.get(st.ownerId);
    if (!owner) { this.#station = null; return; }
    const r = stepStation(st, now);
    if (!r) return;
    if (r.done) { this.#endStation('done'); return; }
    if (r.miss) { this.#releaseTarget(); this.#sendTo(owner, { t: 'station', on: 1, miss: 1, ...stationSummary(st) }); return; }
    // show: the first bot becomes the target, teleported to a spot in the level's band, frozen, at full health
    const bot = [...this.#bots.keys()].map((bid) => this.#players.get(bid)).find((b) => b);
    const spot = pickTargetSpot(this.#map.spawns, owner, st.level, this.#botRng);
    if (!bot || !spot) { st.nextAt = now + 1000; return; }
    Object.assign(bot, { x: spot.x, y: 0, z: spot.z, vx: 0, vy: 0, vz: 0, onGround: true, alive: true, hp: MAX_HP, respawnAt: Infinity, frozen: true, h: PLAYER.height, slide: 0 });
    bot.yaw = Math.atan2(-(owner.x - bot.x), -(owner.z - bot.z)); // face the owner
    st.targetId = bot.id; st.shownAt = now;
    this.#sendTo(owner, { t: 'station', on: 1, target: bot.id, ...stationSummary(st) });
  }
  // Called from the fire path: a hit by the owner on the current target closes the round.
  #stationHit(shooter, victim, now) {
    const st = this.#station;
    if (!st || st.targetId !== victim.id || st.ownerId !== shooter.id) return;
    const ms = recordHit(st, now);
    this.#releaseTarget();
    this.#sendTo(shooter, { t: 'station', on: 1, hit: 1, ms, ...stationSummary(st) });
  }
  #setAfk(p, on) {
    if (p.afk === on) return;
    p.afk = on;
    p.afkBrain = on ? newBrain('easy', this.#botSeed + p.id) : null;
    this.#afkCount += on ? 1 : -1;
    if (!on) p.lastActiveAt = this.#now();
    this.#log?.info(on ? 'player afk' : 'player back', { id: p.id });
  }
  // PRO-audio end

  removePlayer(id) {
    const leaving = this.#players.get(id);
    if (leaving?.afk) this.#afkCount -= 1; // SPEC 37.4
    if (this.#station && (this.#station.ownerId === id || this.#station.targetId === id)) this.#endStation('left'); // SPEC 37.7
    const removed = this.#players.delete(id);
    if (removed) this.#log?.info('player left', { id, players: this.#players.size });
    if (removed && this.#players.size === 0) this.#match = newMatch(this.#match.mode); // SPEC 22: an empty room waits
    if (removed && !this.#balancing) this.#balanceBots(); // PRO-audio: humans leaving or arriving change the fill
    if (removed) this.#roster();
    return removed;
  }

  // SPEC 29.1: chat is relayed, never stored; one line per second per player, sanitized and capped.
  handleChat(id, text) {
    const p = this.#players.get(id);
    if (!p) return false;
    const now = this.#now();
    const clean = sanitizeChat(text);
    if (!clean || !chatAllowed(p.lastChatAt ?? -Infinity, now)) return false;
    p.lastChatAt = now;
    this.#broadcast({ t: 'chat', id, name: p.name, team: p.team, text: clean });
    return true;
  }

  // SPEC 39.8: a ping wheel mark is relayed to the sender's team (to the sender alone without teams), never stored.
  handleMark(id, kind, at) {
    const p = this.#players.get(id);
    if (!p) return false;
    const now = this.#now();
    const clean = sanitizeMark(kind, at);
    if (!clean || !markAllowed(p.lastMarkAt ?? -Infinity, now)) return false;
    p.lastMarkAt = now;
    const msg = { t: 'mark', id, name: p.name, team: p.team, kind: clean.kind, at: clean.at };
    for (const q of this.#players.values()) if (q === p || (p.team >= 0 && q.team === p.team)) this.#sendTo(q, msg);
    return true;
  }

  handleInput(id, cmds, fromBrain = false) {
    const p = this.#players.get(id);
    if (!p || !Array.isArray(cmds)) return;
    if (p.afk && !fromBrain) {
      // SPEC 37.4: while a bot drives the body, human commands are ignored until one of them is active
      if (!cmds.some((c) => cmdIsActive(c, p.humanYaw, p.humanPitch))) return;
      this.#setAfk(p, false);
    }
    for (const c of cmds) {
      if (fromBrain) {
        p.queue.push({ ...c, seq: p.lastQueuedSeq }); // the brain never advances the human's sequence, so their ack stays theirs
        continue;
      }
      if (c.seq > p.lastQueuedSeq) {
        if (!p.bot) {
          if (cmdIsActive(c, p.humanYaw, p.humanPitch)) p.lastActiveAt = this.#now();
          p.humanYaw = c.yaw; p.humanPitch = c.pitch;
        }
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
  // SPEC 38.3: one swing per message; the tick resolves it with the kit's style.
  handleMelee(id) {
    const p = this.#players.get(id);
    if (p) p.wantsMelee = true;
  }

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

    this.#stepBots(now); // PRO-audio: SPEC 35.3
    this.#stepAfk(now); // SPEC 37.4
    this.#stepStation(now); // SPEC 37.7
    for (const p of this.#players.values()) this.#runCommands(p);
    this.#stepAbilities(now);
    for (const p of this.#players.values()) this.#stepWeapons(p, now);
    this.#stepMelee(now); // SPEC 38.3: swings resolve before the trigger, so a clash cancels a shot in the same tick
    for (const p of this.#players.values()) {
      if (p.alive && burstDue(activeWeapon(p.loadout), now)) this.#fire(p, now, true); // SPEC 38.1: burst follow-up rounds
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
      if (p.alive && this.#match.phase !== 'intro') stepPlayer(p, cmd, this.#map.boxes, this.#map.half); // PRO-ceremony: frozen during the intro countdown
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
      if (r.ok) { p.protectedUntil = -Infinity; this.#broadcast({ t: 'ability', id: p.id, ability: r.ability, slot, cd: r.cooldownMs }); } // SPEC 37.2: an ability ends spawn protection like a shot
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
    // PRO-ceremony: the intro countdown ends, the match goes live
    if (updateIntroPhase(this.#match, now)) {
      this.#broadcast({ t: 'matchLive', ...matchSnapshot(this.#match, now) });
      this.#roster();
    }
    if (this.#match.phase !== 'playing') { this.#stepRestart(now); return; }
    this.#stepObjective(now); // SPEC 39
    const reason = endReason(this.#match, this.#players.values(), now);
    if (reason !== null) {
      const medals = matchEndMedals(this.#medals, this.#players.values()); // PRO-ceremony: flawless and the medal totals
      const result = { ...endMatch(this.#match, this.#players.values(), now, reason, voteCandidatesFor(MAP_IDS, this.#map.id)), medals };
      const roster = [...this.#players.values()].filter((p) => !p.bot); // PRO-audio: persistence records humans only
      this.#log?.info('match end', { reason, number: result.number });
      this.#broadcast({ t: 'matchEnd', ...result });
      this.#hook('matchEnd', { result, players: roster, mode: this.#match.mode, nowMs: now });
      this.#roster();
    }
  }

  #stepRestart(now) {
    if (shouldRestart(this.#match, now)) {
      this.#nextMapId = tallyVotes(this.#match); // PRO-ceremony: SPEC 34.4, null when nobody could vote
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
      this.#medals = newMedalTracker(); // PRO-ceremony: medals are per match
      this.#startMatch(now, true); // PRO-ceremony: a restart runs the intro countdown
    }
  }

  // PRO-ceremony begin (SPEC 34.4): one vote per player, only during the end screen, only for an offered map
  handleVote(id, mapId) {
    const p = this.#players.get(id);
    if (!p || !recordVote(this.#match, id, mapId)) return;
    this.#broadcast({ t: 'vote', counts: voteCounts(this.#match) });
  }
  // PRO-ceremony end

  // SPEC 28: the map rotates with the match number; pickups and grenades are rebuilt for it.
  #mapForNumber = 1; // PRO-ceremony: the match number the current map was chosen for (the vote decides once)
  #switchMap(matchNumber) {
    if (this.#mapForNumber === matchNumber && this.#nextMapId === null) return; // already chosen for this match
    const next = MAPS[this.#nextMapId ?? mapForMatch(matchNumber)]; // PRO-ceremony: the vote wins over the rotation
    this.#nextMapId = null;
    this.#mapForNumber = matchNumber;
    if (next === this.#map) return;
    this.#map = next;
    this.#pickups = buildPickups(this.#match.arms ? [] : this.#map.pickups);
    this.#grenades = [];
  }

  #roster() {
    this.#hook('roster', { players: this.humanCount, maxPlayers: this.#maxPlayers, bots: this.#bots.size, phase: this.#match.phase, matchNumber: this.#match.number, nowMs: this.#now() });
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

  // SPEC 39: objective state follows the mode and the map of the current match.
  #resetObjective(now) {
    const kind = modeDef(this.#match.mode).objective ?? null;
    if (kind === 'hill') this.#objective = { kind, state: newHillState(this.#map, now) };
    else if (kind === 'flags') this.#objective = { kind, state: newFlagState(this.#map) };
    else this.#objective = null;
  }

  #stepObjective(now) {
    const o = this.#objective;
    if (!o) return;
    const players = [...this.#players.values()];
    if (o.kind === 'hill') {
      const pts = stepHill(o.state, players, now, TICK_MS);
      if (pts[0] || pts[1]) scoreObjective(this.#match, pts);
      return;
    }
    const { points, events } = stepFlags(o.state, players, now);
    if (points[0] || points[1]) scoreObjective(this.#match, points);
    for (const e of events) {
      this.#broadcast({ t: 'flag', ...e, text: flagEventText(e, TEAM_NAMES) });
      if (e.type === 'capture') this.#log?.info('capture', { by: e.by, team: e.team });
    }
  }

  #objectiveSnapshot(now) {
    const o = this.#objective;
    if (!o) return null;
    return o.kind === 'hill' ? hillSnapshot(o.state, now) : flagsSnapshot(o.state);
  }

  // SPEC 39: read-only view for the bot brains and tests.
  get objective() {
    return this.#objective ? { kind: this.#objective.kind, ...this.#objectiveSnapshot(this.#now()) } : null;
  }

  #startMatch(now, intro = false) {
    this.#fx = []; // SPEC 24: no effects carry over
    startMatch(this.#match, now, { intro });
    this.#switchMap(this.#match.number);
    this.#resetObjective(now); // SPEC 39
    this.#log?.info('match start', { mode: this.#match.mode, number: this.#match.number });
    this.#broadcast({ t: 'matchStart', ...matchSnapshot(this.#match, now), number: this.#match.number, map: describeMap(this.#map), pickups: describePickups(this.#pickups) });
    this.#roster();
  }

  #fire(p, now, burst = false) {
    if (!p.alive || this.#match.phase !== 'playing' || fireBlock(p.loadout, now, burst) !== null) return;
    if (isSwinging(p) || now < p.staggerUntil) return; // SPEC 38.3: no shooting through a swing or a stagger
    const ws = activeWeapon(p.loadout);
    const weapon = weaponDef(ws.id);
    const spread = ws.spread;
    recordShot(ws, now, burst);
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
      if (r.applied > 0) this.#stationHit(p, victim, now); // SPEC 37.7
      this.#sendTo(p, { t: 'hit', id: victim.id });
      if (r.killed) killed.push(victim);
      if (best === null || r.applied > best.applied) best = { victim, zone: acc.zone, dist: acc.dist, applied: r.applied, kill: r.killed };
    }
    this.#sendTo(p, { t: 'verdict', target: best.victim.id, zone: best.zone, dmg: best.applied, dist: best.dist, kill: best.kill });
    for (const v of killed) this.#kill(p.id, p.name, v, now, { zone: best.victim === v ? best.zone : null, dist: best.dist }); // PRO-ceremony: medal inputs
  }

  // SPEC 38.3: starts requested swings, advances every swing, resolves clashes then hits during the active window.
  #stepMelee(now) {
    const all = [...this.#players.values()];
    for (const p of all) {
      if (p.wantsMelee) {
        p.wantsMelee = false;
        if (this.#match.phase !== 'playing') continue;
        const style = startMelee(p, now);
        if (!style) continue;
        const ws = activeWeapon(p.loadout);
        ws.reloadingUntil = -Infinity; // a swing cancels the reload and the burst
        cancelBurst(ws);
        p.protectedUntil = -Infinity; // SPEC 21.2: attacking ends spawn protection
        this.#broadcast({ t: 'melee', id: p.id, style: style.id });
      }
      if (!p.alive) { p.melee = null; continue; }
      if (stepMelee(p, now) !== MELEE_PHASE.active) continue;
      const style = meleeStyle(p.melee.style);
      for (const q of meleeTargets(p, all)) {
        if (sameTeam(p, q)) continue;
        if (clashes(p, q)) {
          const { riposte } = applyClash(p, q, now);
          const mid = [round3((p.x + q.x) / 2), round3((p.y + q.y) / 2 + 1.2), round3((p.z + q.z) / 2)];
          this.#broadcast({ t: 'clash', a: p.id, b: q.id, riposte: riposte.id, at: mid });
          break; // the clash ends this swing
        }
        p.melee.hit.push(q.id);
        const r = this.#protected(q, now) ? { applied: 0, killed: false } : applyDamage(q, style.damage * q.progress.mods.dmgTakenMul);
        if (r.applied > 0) knockback(p, q, style);
        this.#award(p, recordDamage(p.progress, q.progress, p.id, q.id, r.applied, now));
        this.#sendTo(p, { t: 'hit', id: q.id });
        const dist = round3(Math.hypot(q.x - p.x, q.z - p.z));
        this.#sendTo(p, { t: 'verdict', target: q.id, zone: 'melee', dmg: r.applied, dist, kill: r.killed });
        if (r.killed) this.#kill(p.id, p.name, q, now, { zone: 'melee', dist });
      }
    }
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
  #kill(killerId, killerName, victim, now, { zone = null, dist = NaN } = {}) {
    victim.alive = false;
    victim.deaths += 1;
    victim.respawnAt = now + RESPAWN_MS;
    const killer = this.#players.get(killerId);
    if (killer && killer !== victim) killer.kills += 1;
    scoreKill(this.#match, killer, victim);
    if (this.#match.arms && killer && killer !== victim && !sameTeam(killer, victim)) this.#armsKill(killer.team, now); // SPEC 40.3
    // PRO-ceremony (SPEC 34.3): medals are judged here, where the kill is authoritative, and broadcast with the kill
    const awarded = recordKillMedals(this.#medals, { killerId, victimId: victim.id, isHeadshot: zone === 'head', nowMs: now, dist });
    if (awarded.length) this.#broadcast({ t: 'medal', id: killerId, name: killerName, medals: awarded });
    // SPEC 25.1: kill and assist XP
    if (killer && killer !== victim) this.#award(killer, XP.kill);
    for (const aid of assistsFor(victim.progress, killerId, now)) {
      const a = this.#players.get(aid);
      if (a && a !== victim && !(a.team >= 0 && a.team === victim.team)) this.#award(a, XP.assist);
    }
    victim.grapple = null;
    victim.dash = 0;
    this.#log?.info('kill', { killer: killerId, victim: victim.id });
    // SPEC 29.2: streaks and multi-kills ride on the kill message; the victim's streak ends here
    const ended = resetStreak(victim);
    const ann = killer && killer !== victim ? recordKill(killer, now) : null;
    this.#broadcast({
      t: 'kill', killer: killerId, victim: victim.id, killerName, victimName: victim.name,
      ...(ann?.streakText ? { streak: ann.streak, streakText: ann.streakText } : {}), // only milestones ride along
      ...(ann?.multiText ? { multi: ann.multi, multiText: ann.multiText } : {}),
      ...(streakEndedText(killerName, victim.name, ended) ? { ended } : {}),
    });
  }

  #protected(p, now) {
    return now < p.protectedUntil;
  }

  // SPEC 40.3: one enemy kill on the arms ladder. A stage change re-arms every living teammate at once (full
  // magazine and reserve, melee untouched) and is announced to everyone; the win is read by endReason next tick.
  #armsKill(team, now) {
    const r = armsKill(this.#match.arms, team);
    if (!r.advanced) return;
    for (const p of this.#players.values()) {
      if (p.team !== team || !p.alive) continue;
      p.loadout = newLoadout(armsLoadoutIds(this.#match.arms, team));
      p.wantsReload = false;
      p.wantsSwitch = null;
    }
    this.#broadcast({ t: 'stage', team, stage: r.stage, weapon: r.weapon, text: stageText(team, r.stage) });
    void now;
  }

  #respawn(p, now) {
    this.#place(p);
    p.protectedUntil = now + SPAWN.protectMs;
    p.hp = MAX_HP;
    p.alive = true;
    p.melee = null; p.staggerUntil = -Infinity; // SPEC 38.3
    p.grenades = GRENADE.perLife + p.progress.mods.grenades; // SPEC 25.2 Grenadier
    p.loadout = this.#match.arms && p.team >= 0 ? newLoadout(armsLoadoutIds(this.#match.arms, p.team)) : newLoadout(); // SPEC 40.3
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
    // SPEC 37.1: deathmatch radar pulse, on the match clock so the client's ring and the reveal agree
    const radar = this.#match.phase === 'playing' && radarActive(this.#match.mode, now - this.#match.startedAt);
    for (const p of this.#players.values()) {
      const ws = activeWeapon(p.loadout);
      players.push({
        id: p.id, name: p.name, ...(p.bot ? { bot: 1 } : {}), // PRO-audio: bots are marked for the scoreboard
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
        sc: radar || now < p.scannedUntil ? 1 : 0, // SPEC 24.3 revealed by a scan, SPEC 37.1 or by the radar pulse
        ...(p.afk ? { afk: 1 } : {}), // SPEC 37.4
        ml: snapshotMelee(p), // SPEC 38.3: melee phase (0 none, 1 windup, 2 active, 3 recovery, 4 clash)
        ...(this.#objective?.kind === 'flags' && carrying(this.#objective.state, p.id) ? { fl: 1 } : {}), // SPEC 39.3: carrying a flag
      });
    }
    const nades = this.#grenades.map((g) => ({ id: g.id, x: round3(g.x), y: round3(g.y), z: round3(g.z) }));
    const items = availableIndices(this.#pickups, now);
    const match = { ...matchSnapshot(this.#match, now), obj: this.#objectiveSnapshot(now) }; // SPEC 39: objective state rides on the match block
    const fx = describeEffects(this.#fx, now);
    for (const p of this.#players.values()) {
      // SPEC 24.5: the recipient's private block: cooldowns, dash state for prediction, progression
      const self = { cd: [cooldownLeft(p.kitState, 0, now), cooldownLeft(p.kitState, 1, now)], kit: p.kitState.kit, ...(p.dash > 0 ? { dash: round3(p.dash), dashDx: round3(p.dashDx), dashDz: round3(p.dashDz) } : {}), ...(p.grapple ? { grapple: 1 } : {}), ...progressSnapshot(p.progress) };
      this.#sendTo(p, { t: 'snap', tick: this.#tick, ack: p.lastSeq, players, nades, items, match, fx, self, ...(radar ? { radar: 1 } : {}) });
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
