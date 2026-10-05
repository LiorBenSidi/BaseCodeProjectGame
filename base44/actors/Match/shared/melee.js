// Kit-bound melee and the clash (docs/SPEC.md section 38.3, D-037).
//
// A swing is a small state machine: windup -> active -> recovery. During `active` the swing tests a cone in front of
// the attacker once per victim. The unique twist is the clash: when two players swing at each other and both cones
// hold the other during the same active window, neither takes damage. Both are thrown apart and staggered, and the
// player who swung LATER (the one who read the attack and answered it) recovers first. We call that the riposte:
// a reactive swing is a parry with teeth, which is what makes close range a read instead of a damage race.
//
// Pure: no server or renderer imports. The room owns the player objects and the broadcasts.
import { meleeStyle } from './weapons.js';

export const MELEE_PHASE = Object.freeze({ none: 0, windup: 1, active: 2, recovery: 3, clash: 4 });
export const CLASH = Object.freeze({
  staggerMs: 600, // the attacker who swung first
  riposteMs: 250, // the later swing: recovers first, so the follow-up is theirs
  knockbackSpeed: 18, // reuses the dash lane (fixed speed, locked direction)
  knockbackDist: 2.0, // metres each player travels apart
  heightTolerance: 1.6, // metres of eye-height difference a swing still reaches
});

// A new swing, or null when the player cannot swing now (dead, mid swing, staggered).
export function startMelee(p, now) {
  if (!p.alive) return null;
  if (p.melee && p.melee.phase !== MELEE_PHASE.none) return null;
  if (now < (p.staggerUntil ?? -Infinity)) return null;
  const style = meleeStyle(p.kitState?.kit);
  p.melee = { phase: MELEE_PHASE.windup, style: style.id, startedAt: now, hit: [], clashed: false };
  return style;
}

// Advances the phases. Returns the phase after the step. The caller runs the hit test while the phase is `active`.
export function stepMelee(p, now) {
  const m = p.melee;
  if (!m || m.phase === MELEE_PHASE.none) return MELEE_PHASE.none;
  if (m.phase === MELEE_PHASE.clash) {
    if (now >= m.until) p.melee = null;
    return p.melee ? MELEE_PHASE.clash : MELEE_PHASE.none;
  }
  const st = meleeStyle(m.style);
  const t = now - m.startedAt;
  if (t < st.windupMs) m.phase = MELEE_PHASE.windup;
  else if (t < st.windupMs + st.activeMs) m.phase = MELEE_PHASE.active;
  else if (t < st.windupMs + st.activeMs + st.recoveryMs) m.phase = MELEE_PHASE.recovery;
  else { p.melee = null; return MELEE_PHASE.none; }
  return m.phase;
}

export const meleePhase = (p) => p.melee?.phase ?? MELEE_PHASE.none;
export const isSwinging = (p) => { const ph = meleePhase(p); return ph === MELEE_PHASE.windup || ph === MELEE_PHASE.active; };

// Forward on the ground plane: the camera looks down -Z at yaw 0, +yaw turns left (movement.js).
export const forward2 = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

// Whether q stands inside p's melee cone (ground plane distance and angle, with a height tolerance).
export function inCone(p, q, style) {
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > style.range || Math.abs(q.y - p.y) > CLASH.heightTolerance) return false;
  if (d < 1e-6) return true;
  const [fx, fz] = forward2(p.yaw);
  const cos = (dx * fx + dz * fz) / d;
  return cos >= Math.cos(style.angleRad / 2);
}

// Victims of this active window not yet hit by this swing, in distance order.
export function meleeTargets(p, candidates) {
  const m = p.melee;
  if (!m || m.phase !== MELEE_PHASE.active) return [];
  const st = meleeStyle(m.style);
  return candidates
    .filter((q) => q !== p && q.alive && !m.hit.includes(q.id) && inCone(p, q, st))
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
}

// The clash test: q is also swinging (windup or active) and p stands inside q's cone.
export function clashes(p, q) {
  if (!isSwinging(q) || !p.melee) return false;
  return inCone(q, p, meleeStyle(q.melee.style));
}

// Applies a clash to both. The later swing is the riposte. Returns { riposte, staggered } by player.
export function applyClash(p, q, now) {
  const later = p.melee.startedAt >= q.melee.startedAt ? p : q;
  const first = later === p ? q : p;
  const [ax, az] = pushApart(first, later);
  for (const [who, ms, dir] of [[first, CLASH.staggerMs, [-ax, -az]], [later, CLASH.riposteMs, [ax, az]]]) {
    who.melee = { phase: MELEE_PHASE.clash, style: who.melee.style, startedAt: now, until: now + ms, hit: [], clashed: true };
    who.staggerUntil = now + ms;
    who.dash = CLASH.knockbackDist / CLASH.knockbackSpeed;
    who.dashDx = dir[0];
    who.dashDz = dir[1];
    who.slide = 0;
  }
  return { riposte: later, staggered: first };
}

// Knocks q away from p along the ground. Reuses the dash lane so the push survives the ground speed reset.
export function knockback(p, q, style) {
  const [ax, az] = pushApart(p, q);
  q.dash = style.knockback / CLASH.knockbackSpeed;
  q.dashDx = ax;
  q.dashDz = az;
  q.slide = 0;
}

// Unit vector from a toward b on the ground plane (a's forward when they overlap).
export function pushApart(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  return d < 1e-6 ? forward2(a.yaw) : [dx / d, dz / d];
}

// A swing (or clash) in flight, as a code for the snapshot (`ml`) and the third person animation.
export const snapshotMelee = (p) => meleePhase(p);
