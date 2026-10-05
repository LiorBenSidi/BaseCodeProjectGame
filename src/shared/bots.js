// Bots (SPEC 35.3, D-032). Pure and deterministic: the room hands the brain its player, the others, the map and the
// clock, and gets back the input command plus fire / reload intents. Randomness comes from the injected rng, so the
// same seed replays the same match. No DOM, no timers.
import { INPUT_DT, PLAYER } from './constants.js';
import { aimDir, playerBox, castRay } from './hitscan.js';
import { eyeOf } from './movement.js';

export const DIFFICULTIES = Object.freeze({
  dummy: Object.freeze({ id: 'dummy', name: 'Dummy', reactionMs: Infinity, aimErrorRad: 0, fireChance: 0, strafe: false, engageRange: 0, speed: 0.6 }),
  easy: Object.freeze({ id: 'easy', name: 'Easy', reactionMs: 650, aimErrorRad: 0.11, fireChance: 0.45, strafe: true, engageRange: 45, speed: 0.8 }),
  medium: Object.freeze({ id: 'medium', name: 'Medium', reactionMs: 380, aimErrorRad: 0.05, fireChance: 0.7, strafe: true, engageRange: 60, speed: 1 }),
  hard: Object.freeze({ id: 'hard', name: 'Hard', reactionMs: 180, aimErrorRad: 0.02, fireChance: 0.92, strafe: true, engageRange: 80, speed: 1 }),
});
export const DIFFICULTY_IDS = Object.freeze(Object.keys(DIFFICULTIES));
export const BOT_NAMES = Object.freeze(['Vector', 'Nomad', 'Cipher', 'Rook', 'Talon', 'Mirage', 'Onyx', 'Havoc', 'Drift', 'Echo', 'Jett', 'Kilo']);
export const THINK_MS = 120; // decisions at ~8 Hz, movement every tick
export const STUCK_MS = 900;
export const WAYPOINT_REACH_M = 1.5;
export const MIN_RANGE_M = 6;
export const PUSH_RANGE_M = 18;

export const isDifficulty = (id) => typeof id === 'string' && Object.hasOwn(DIFFICULTIES, id);

export function newBrain(difficulty = 'medium', seed = 0) {
  const d = DIFFICULTIES[difficulty] ?? DIFFICULTIES.medium;
  return {
    difficulty: d.id,
    seq: 0,
    waypoint: null,
    target: null,
    seenAt: -Infinity, // when the current target was first seen (reaction timer)
    thinkAt: -Infinity,
    strafe: 1,
    strafeUntil: -Infinity,
    lastPos: null,
    lastMoveAt: -Infinity,
    jumpUntil: -Infinity,
    yaw: 0,
    pitch: 0,
    nameIndex: seed % BOT_NAMES.length,
    seed: seed | 0, // SPEC 39.5: role split on the objective
    detourUntil: -Infinity,
  };
}

export const botName = (brain, taken = new Set()) => {
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const n = BOT_NAMES[(brain.nameIndex + i) % BOT_NAMES.length];
    if (!taken.has(n)) return n;
  }
  return `Bot${brain.nameIndex}`;
};

const inAnyBox = (x, z, boxes, pad = PLAYER.radius + 0.2) => boxes.some((b) => x > b.min[0] - pad && x < b.max[0] + pad && z > b.min[2] - pad && z < b.max[2] + pad && b.max[1] - b.min[1] > 0.4);

// A random walkable point: a spawn point most of the time, otherwise a free spot inside the arena.
export function pickWaypoint(map, rng) {
  const spawns = map.spawns ?? [];
  if (spawns.length && rng() < 0.6) { const s = spawns[Math.floor(rng() * spawns.length) % spawns.length]; return { x: s.x, z: s.z }; }
  const half = (map.half ?? 20) - 1.5;
  for (let i = 0; i < 12; i++) {
    const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
    if (!inAnyBox(x, z, map.boxes ?? [])) return { x, z };
  }
  return spawns[0] ? { x: spawns[0].x, z: spawns[0].z } : { x: 0, z: 0 };
}

const wrapPi = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z)); // yaw 0 looks toward -Z (movement.js)

// Line of sight from the bot's eye to the target's chest, blocked only by the map.
export function canSee(bot, target, boxes, range) {
  const o = [bot.x, bot.y + eyeOf(bot), bot.z];
  const aim = [target.x, target.y + eyeOf(target) * 0.75, target.z];
  const d = [aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]];
  const len = Math.hypot(...d);
  if (len > range || len < 1e-6) return false;
  const dir = d.map((v) => v / len);
  const r = castRay(o, dir, len + 0.5, boxes, [{ id: target.id, box: playerBox(target) }]);
  return r.targetId === target.id;
}

// Picks the closest visible enemy. Teams: `sameTeam(a, b)` decides; DM players have team -1.
export function chooseTarget(bot, others, boxes, range, sameTeam = (a, b) => a.team >= 0 && a.team === b.team) {
  let best = null, bestD = Infinity;
  for (const o of others) {
    if (o.id === bot.id || !o.alive || sameTeam(bot, o)) continue;
    const d = Math.hypot(o.x - bot.x, o.z - bot.z);
    if (d >= bestD) continue;
    if (!canSee(bot, o, boxes, range)) continue;
    best = o; bestD = d;
  }
  return best;
}

// One tick of the brain. Returns { cmd, shoot, reload }. `bot` is the room's player record (read only here).
// SPEC 39.5: where a bot should be for the objective, or null to roam. `obj` is the room's objective snapshot plus
// `carrying` (this bot holds a flag). KOTH: everybody goes to the hill, spread on a ring so they do not stack.
// CTF: a carrier runs home; if the own flag is away, odd-seeded bots chase it; otherwise bots go for the enemy flag,
// and even-seeded bots on a full team hang back near their own flag.
export function objectiveGoal(obj, bot, brain) {
  if (!obj || bot.team < 0) return null;
  if (obj.kind === 'hill') {
    const a = (brain.seed % 8) * (Math.PI / 4);
    const r = Math.max(0.5, obj.r - 2);
    return { x: obj.x + Math.cos(a) * r, z: obj.z + Math.sin(a) * r, hold: obj.r - 0.5, label: 'hill' };
  }
  if (obj.kind === 'flags') {
    const own = obj.flags[bot.team], enemy = obj.flags[1 - bot.team];
    const home = obj.bases[bot.team];
    if (obj.carrying) return { x: home.x, z: home.z, hold: 0, label: 'home' };
    const defender = brain.seed % 2 === 1;
    if (own.state !== 'home' && (defender || own.state === 'dropped')) return { x: own.x, z: own.z, hold: 0, label: 'recover' };
    if (enemy.state === 'carried') return { x: home.x, z: home.z, hold: 2.5, label: 'escort' }; // a teammate has it: cover the base
    return { x: enemy.x, z: enemy.z, hold: 0, label: 'take' };
  }
  return null;
}

export function botStep(brain, bot, others, map, nowMs, rng = Math.random, sameTeam, objective = null) {
  const d = DIFFICULTIES[brain.difficulty];
  const boxes = map.boxes ?? [];
  brain.seq += 1;
  const idle = { cmd: { seq: brain.seq, dt: INPUT_DT, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, yaw: brain.yaw, pitch: brain.pitch }, shoot: false, reload: false };
  if (!bot.alive) { brain.target = null; brain.waypoint = null; return idle; }

  // stuck detection: no horizontal progress for STUCK_MS while trying to move
  if (brain.lastPos && Math.hypot(bot.x - brain.lastPos.x, bot.z - brain.lastPos.z) > 0.05) brain.lastMoveAt = nowMs;
  if (brain.lastPos === null) brain.lastMoveAt = nowMs;
  brain.lastPos = { x: bot.x, z: bot.z };

  if (nowMs >= brain.thinkAt) {
    brain.thinkAt = nowMs + THINK_MS;
    const seen = d.engageRange > 0 ? chooseTarget(bot, others, boxes, d.engageRange, sameTeam) : null;
    if (seen && seen.id !== brain.target) { brain.target = seen.id; brain.seenAt = nowMs; }
    if (!seen) brain.target = null;
    if (nowMs - brain.lastMoveAt > STUCK_MS) { brain.waypoint = pickWaypoint(map, rng); brain.detourUntil = nowMs + 2500; brain.jumpUntil = nowMs + 200; brain.lastMoveAt = nowMs; } // SPEC 39.5: a stuck bot detours before returning to the objective
    if (nowMs >= brain.strafeUntil) { brain.strafe = rng() < 0.5 ? -1 : 1; brain.strafeUntil = nowMs + 500 + rng() * 800; }
  }

  const goal = objectiveGoal(objective, bot, brain); // SPEC 39.5
  const carrier = !!objective?.carrying;
  const target = brain.target !== null && !carrier ? others.find((o) => o.id === brain.target && o.alive) : null; // a carrier runs, it does not fight
  let fwd = 0, right = 0, sprint = false, shoot = false;
  const goalDist = goal ? Math.hypot(goal.x - bot.x, goal.z - bot.z) : Infinity;
  if (goal && !target && nowMs >= (brain.detourUntil ?? 0) && goalDist <= goal.hold) {
    // on the objective: hold it, look around slowly, shuffle sideways so the bot is not a sitting duck
    brain.yaw += 0.02 * (brain.seed % 2 === 0 ? 1 : -1);
    brain.pitch += (0 - brain.pitch) * 0.2;
    right = Math.sin(nowMs / 700) > 0 ? 0.4 : -0.4;
  } else if (target) {
    const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
    const dy = (target.y + eyeOf(target) * 0.75) - (bot.y + eyeOf(bot));
    const wantYaw = yawTo(bot, target);
    const wantPitch = Math.atan2(dy, Math.max(0.1, dist));
    const reacting = nowMs - brain.seenAt < d.reactionMs;
    // turn toward the target, faster once the reaction time has passed; aim error is a slow wander, not per tick jitter
    const turn = reacting ? 0.12 : 0.35;
    const err = d.aimErrorRad * Math.sin(nowMs / 230 + brain.seq * 0.01);
    brain.yaw += wrapPi(wantYaw + err - brain.yaw) * turn;
    brain.pitch += (wantPitch + err * 0.5 - brain.pitch) * turn;
    const onTarget = Math.abs(wrapPi(wantYaw - brain.yaw)) < 0.06 + d.aimErrorRad;
    shoot = !reacting && onTarget && rng() < d.fireChance;
    if (goal && dist > PUSH_RANGE_M && goalDist > goal.hold && nowMs >= (brain.detourUntil ?? 0)) {
      // SPEC 39.5: a far enemy is shot at on the way; the legs still belong to the objective (wish vector in the facing frame)
      const dx = (goal.x - bot.x) / goalDist, dz = (goal.z - bot.z) / goalDist;
      const sin = Math.sin(brain.yaw), cos = Math.cos(brain.yaw);
      fwd = -sin * dx - cos * dz;
      right = cos * dx - sin * dz;
      sprint = false;
    } else {
      if (d.strafe) right = brain.strafe;
      if (dist > PUSH_RANGE_M) fwd = 1; else if (dist < MIN_RANGE_M) fwd = -0.6;
    }
  } else {
    const detour = nowMs < (brain.detourUntil ?? 0);
    if (goal && !detour) brain.waypoint = { x: goal.x, z: goal.z }; // SPEC 39.5: the objective is the waypoint
    else if (!brain.waypoint || Math.hypot(brain.waypoint.x - bot.x, brain.waypoint.z - bot.z) < WAYPOINT_REACH_M) brain.waypoint = pickWaypoint(map, rng);
    const wantYaw = yawTo(bot, brain.waypoint);
    brain.yaw += wrapPi(wantYaw - brain.yaw) * 0.2;
    brain.pitch += (0 - brain.pitch) * 0.2;
    fwd = d.speed;
    sprint = d.speed >= 1 && Math.abs(wrapPi(wantYaw - brain.yaw)) < 0.3;
  }
  brain.yaw = wrapPi(brain.yaw);
  brain.pitch = Math.max(-1.2, Math.min(1.2, brain.pitch));
  const reload = !!bot.loadout && (bot.loadout[bot.loadout.active]?.mag ?? 1) === 0;
  return {
    cmd: { seq: brain.seq, dt: INPUT_DT, fwd, right, jump: nowMs < brain.jumpUntil, sprint, crouch: false, yaw: brain.yaw, pitch: brain.pitch },
    shoot: shoot && !reload,
    reload,
  };
}

// How many bots a room should hold: fill up to `fillTo` seats with bots, never displacing a human.
export const botsWanted = (humans, fillTo, maxPlayers) => Math.max(0, Math.min(fillTo, maxPlayers) - humans);

// Small deterministic generator for the room (mulberry32).
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
