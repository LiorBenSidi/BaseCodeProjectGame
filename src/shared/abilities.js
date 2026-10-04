// Kits and abilities (docs/SPEC.md section 24, D-023). Pure: time is `nowMs`, randomness is injected.
// The room owns the effect list (`fx`) this module builds and steps; the client renders what the snapshot says.

import { MAX_HP, PLAYER } from './constants.js';
import { aimDir, rayAabb } from './hitscan.js';

export const KITS = Object.freeze({
  vanguard: Object.freeze({ id: 'vanguard', name: 'Vanguard', abilities: ['dash', 'shield'], blurb: 'Close the gap, hold the line.' }),
  phantom: Object.freeze({ id: 'phantom', name: 'Phantom', abilities: ['blink', 'decoy'], blurb: 'Be where they do not look.' }),
  engineer: Object.freeze({ id: 'engineer', name: 'Engineer', abilities: ['grapple', 'scan'], blurb: 'Own the high ground, see through walls.' }),
  medic: Object.freeze({ id: 'medic', name: 'Medic', abilities: ['heal', 'stasis'], blurb: 'Keep the team up, slow the enemy down.' }),
});
export const KIT_IDS = Object.freeze(Object.keys(KITS));
export const DEFAULT_KIT = 'vanguard';

export const ABILITIES = Object.freeze({
  dash: Object.freeze({ id: 'dash', name: 'Dash', cooldownMs: 5000, speed: 18, time: 0.2 }),
  shield: Object.freeze({ id: 'shield', name: 'Shield', cooldownMs: 12000, ttlMs: 8000, width: 3, height: 2.2, depth: 0.3, offset: 1.5 }),
  blink: Object.freeze({ id: 'blink', name: 'Blink', cooldownMs: 8000, range: 8 }),
  decoy: Object.freeze({ id: 'decoy', name: 'Decoy', cooldownMs: 14000, ttlMs: 6000, hp: 25, speed: 4 }),
  grapple: Object.freeze({ id: 'grapple', name: 'Grapple', cooldownMs: 7000, range: 25, pull: 16, maxMs: 1500, releaseAt: 1.2 }),
  scan: Object.freeze({ id: 'scan', name: 'Scan', cooldownMs: 10000, radius: 25, revealMs: 5000 }),
  heal: Object.freeze({ id: 'heal', name: 'Heal Zone', cooldownMs: 12000, ttlMs: 6000, radius: 4, hpPerSec: 10 }),
  stasis: Object.freeze({ id: 'stasis', name: 'Stasis Field', cooldownMs: 15000, ttlMs: 6000, radius: 6, slow: 0.5 }),
});

export function kitDef(id) {
  const k = KITS[id];
  if (!k) throw new RangeError(`unknown kit: ${id}`);
  return k;
}
export const isKit = (id) => typeof id === 'string' && Object.hasOwn(KITS, id);

// Per-player kit state. `readyAt` per slot; cooldowns survive death, reset on match restart (newKitState again).
export function newKitState(kitId = DEFAULT_KIT) {
  kitDef(kitId);
  return { kit: kitId, readyAt: [-Infinity, -Infinity] };
}

export const abilityAt = (ks, slot) => ABILITIES[kitDef(ks.kit).abilities[slot]];
export const cooldownLeft = (ks, slot, nowMs) => Math.max(0, ks.readyAt[slot] - nowMs);
export const abilityReady = (ks, slot, nowMs) => cooldownLeft(ks, slot, nowMs) === 0;

// Horizontal ray against the boxes from a point: how far (<= range) the centre can travel.
function freeDistance(origin, dir, range, boxes) {
  let t = range;
  for (const b of boxes) {
    // widen the box by the player's radius so the body itself does not end up inside
    const min = [b.min[0] - PLAYER.radius, b.min[1], b.min[2] - PLAYER.radius];
    const max = [b.max[0] + PLAYER.radius, b.max[1], b.max[2] + PLAYER.radius];
    const h = rayAabb(origin, dir, min, max);
    if (h !== null && h < t) t = h;
  }
  return t;
}

// Uses the ability in `slot`. `ctx`: { nowMs, boxes, half, players (iterable of others), fx (array), nextFxId (fn), cdMul }.
// Returns { ok, ability, cooldownMs } or { ok: false, reason }. Mutates p and ctx.fx.
export function useAbility(p, slot, ctx) {
  const ks = p.kitState;
  if (!ks || (slot !== 0 && slot !== 1)) return { ok: false, reason: 'bad_slot' };
  if (!p.alive) return { ok: false, reason: 'dead' };
  if (!abilityReady(ks, slot, ctx.nowMs)) return { ok: false, reason: 'cooldown' };
  const a = abilityAt(ks, slot);
  const yaw = p.yaw;
  const fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const team = p.team;
  switch (a.id) {
    case 'dash': {
      // Direction: current horizontal velocity if moving, else facing. Timer runs inside stepPlayer (SPEC 24.2).
      const vl = Math.hypot(p.vx, p.vz);
      p.dash = a.time;
      p.dashDx = vl > 0.5 ? p.vx / vl : fwd[0];
      p.dashDz = vl > 0.5 ? p.vz / vl : fwd[2];
      break;
    }
    case 'shield': {
      const cx = p.x + fwd[0] * a.offset;
      const cz = p.z + fwd[2] * a.offset;
      // axis aligned wall across the facing direction: wide along the axis the player is not facing
      const facingX = Math.abs(fwd[0]) > Math.abs(fwd[2]);
      const hw = facingX ? a.depth / 2 : a.width / 2;
      const hd = facingX ? a.width / 2 : a.depth / 2;
      ctx.fx.push({ id: ctx.nextFxId(), kind: 'shield', owner: p.id, team, x: cx, y: p.y, z: cz, yaw, until: ctx.nowMs + a.ttlMs,
        box: { min: [cx - hw, p.y, cz - hd], max: [cx + hw, p.y + a.height, cz + hd] } });
      break;
    }
    case 'blink': {
      const origin = [p.x, p.y + 0.9, p.z];
      const d = Math.max(0, freeDistance(origin, fwd, a.range, ctx.boxes) - 0.05);
      const lim = ctx.half - PLAYER.radius;
      p.x = Math.max(-lim, Math.min(lim, p.x + fwd[0] * d));
      p.z = Math.max(-lim, Math.min(lim, p.z + fwd[2] * d));
      p.vx = 0; p.vz = 0; p.vy = Math.max(0, p.vy);
      break;
    }
    case 'decoy': {
      ctx.fx.push({ id: ctx.nextFxId(), kind: 'decoy', owner: p.id, name: p.name, team, x: p.x, y: p.y, z: p.z, yaw, hp: a.hp,
        dx: fwd[0] * a.speed, dz: fwd[2] * a.speed, until: ctx.nowMs + a.ttlMs });
      break;
    }
    case 'grapple': {
      const origin = [p.x, p.y + PLAYER.eye, p.z];
      const dir = aimDir(p.yaw, p.pitch);
      let t = Infinity;
      for (const b of ctx.boxes) {
        const h = rayAabb(origin, dir, b.min, b.max);
        if (h !== null && h < t) t = h;
      }
      if (!(t <= a.range)) return { ok: false, reason: 'no_anchor' };
      p.grapple = { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, z: origin[2] + dir[2] * t, until: ctx.nowMs + a.maxMs };
      break;
    }
    case 'scan': {
      for (const q of ctx.players) {
        if (q === p || !q.alive || (team >= 0 && q.team === team)) continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) <= a.radius) q.scannedUntil = ctx.nowMs + a.revealMs;
      }
      break;
    }
    case 'heal':
      ctx.fx.push({ id: ctx.nextFxId(), kind: 'heal', owner: p.id, team, x: p.x, y: p.y, z: p.z, r: a.radius, until: ctx.nowMs + a.ttlMs });
      break;
    case 'stasis':
      ctx.fx.push({ id: ctx.nextFxId(), kind: 'stasis', owner: p.id, team, x: p.x, y: p.y, z: p.z, r: a.radius, until: ctx.nowMs + a.ttlMs });
      break;
    default:
      return { ok: false, reason: 'unknown' };
  }
  const cooldownMs = Math.round(a.cooldownMs * (ctx.cdMul ?? 1));
  ks.readyAt[slot] = ctx.nowMs + cooldownMs;
  return { ok: true, ability: a.id, cooldownMs };
}

// Ally test for zones: in DM only the owner; in TDM the owner's team.
const alliedTo = (fxOrP, q) => q.id === fxOrP.owner || (fxOrP.team >= 0 && q.team === fxOrP.team);
const inside = (fx, q) => Math.hypot(q.x - fx.x, q.z - fx.z) <= fx.r && Math.abs(q.y - fx.y) <= 2.5;

// Movement multiplier for a player standing in an enemy stasis field (SPEC 24.4). 1 when free.
export function slowFactor(fx, q) {
  let k = 1;
  for (const f of fx) if (f.kind === 'stasis' && !alliedTo(f, q) && inside(f, q)) k = Math.min(k, ABILITIES.stasis.slow);
  return k;
}

// One tick: heal zones tick, decoys walk, expired effects leave. Returns the removed effects.
export function stepEffects(fx, players, nowMs, dtMs, boxes) {
  const dt = dtMs / 1000;
  const gone = [];
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    if (nowMs >= f.until || (f.kind === 'decoy' && f.hp <= 0)) { gone.push(f); fx.splice(i, 1); continue; }
    if (f.kind === 'heal') {
      for (const q of players) {
        if (!q.alive || !alliedTo(f, q) || !inside(f, q)) continue;
        q.hp = Math.min(MAX_HP, Math.round((q.hp + ABILITIES.heal.hpPerSec * dt) * 100) / 100);
      }
    } else if (f.kind === 'decoy') {
      const nx = f.x + f.dx * dt;
      const nz = f.z + f.dz * dt;
      const R = PLAYER.radius;
      let blocked = false;
      for (const b of boxes) {
        if (nx + R > b.min[0] && nx - R < b.max[0] && f.y + 1 > b.min[1] && f.y < b.max[1] && nz + R > b.min[2] && nz - R < b.max[2]) { blocked = true; break; }
      }
      if (!blocked) { f.x = nx; f.z = nz; } else { f.dx = 0; f.dz = 0; }
    }
  }
  return gone;
}

// Grapple pull, applied before the player's commands run (SPEC 24.3). Returns true while attached.
export function applyGrapple(p, cmdJump, nowMs) {
  const g = p.grapple;
  if (!g) return false;
  const dx = g.x - p.x;
  const dy = g.y - (p.y + PLAYER.eye);
  const dz = g.z - p.z;
  const d = Math.hypot(dx, dy, dz);
  if (nowMs >= g.until || cmdJump || d <= ABILITIES.grapple.releaseAt || !p.alive) { p.grapple = null; return false; }
  const s = ABILITIES.grapple.pull / d;
  p.vx = dx * s; p.vy = dy * s; p.vz = dz * s;
  p.onGround = false;
  return true;
}

export const shieldBoxes = (fx) => fx.filter((f) => f.kind === 'shield').map((f) => f.box);
export const decoyTargets = (fx) => fx.filter((f) => f.kind === 'decoy').map((f) => ({ id: -f.id, p: f, fx: f }));

// Compact snapshot form of the effects.
export function describeEffects(fx, nowMs) {
  return fx.map((f) => ({ id: f.id, k: f.kind, o: f.owner, tm: f.team, x: r3(f.x), y: r3(f.y), z: r3(f.z), yaw: f.yaw === undefined ? undefined : r3(f.yaw), r: f.r, nm: f.name, ttl: Math.max(0, f.until - nowMs) }));
}
const r3 = (v) => Math.round(v * 1000) / 1000;
