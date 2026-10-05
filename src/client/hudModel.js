import { WEAPONS } from '../shared/weapons.js';
import { RESPAWN_MS } from '../shared/constants.js';
import { TEAM_NAMES } from '../shared/modes.js'; // SPEC 39

// Screen angle of the attacker, clockwise from the top of the screen (0 = straight ahead,
// +PI/2 = right, PI = behind). The camera looks down -Z at yaw 0 and +yaw turns left
// (src/shared/movement.js), so turning left by yaw moves a fixed attacker to the right: add yaw.
export function calculateDamageAngle(player, yaw, attacker) {
  const dx = attacker.x - player.x;
  const dz = attacker.z - player.z;
  let angle = Math.atan2(dx, -dz) + yaw;

  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;

  return angle;
}

export class KillFeedQueue {
  #maxSize;
  #expiryMs;
  #entries = [];

  constructor(maxSize = 5, expiryMs = 5000) {
    this.#maxSize = maxSize;
    this.#expiryMs = expiryMs;
  }

  add(text, now = Date.now()) {
    if (!text) return;
    this.#entries.push({ text, time: now });
    if (this.#entries.length > this.#maxSize) {
      this.#entries.splice(0, this.#entries.length - this.#maxSize);
    }
  }

  getEntries(now = Date.now()) {
    this.#entries = this.#entries.filter((entry) => now - entry.time <= this.#expiryMs);
    return [...this.#entries];
  }
}

export function deriveHealthSegments(hp, maxHp = 100, segmentsCount = 5) {
  const percent = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
  const segmentSize = maxHp / segmentsCount;
  const segments = [];

  for (let i = 0; i < segmentsCount; i++) {
    const fill = Math.max(0, Math.min(segmentSize, hp - i * segmentSize));
    segments.push(fill / segmentSize);
  }

  return { percent, segments };
}

export function deriveRespawnText(alive, now, deathTime, respawnMs = RESPAWN_MS) {
  if (alive === 1 || alive === true) {
    return null;
  }

  const dt = deathTime ?? now;
  const remainingMs = Math.max(0, dt + respawnMs - now);
  const sec = (remainingMs / 1000).toFixed(1);

  return {
    visible: true,
    text: `Respawning in ${sec}s...`,
  };
}

// SPEC 20.4: the ammo readout from the own snapshot entry (w, m, r, rel). Without weapon fields (an
// older server) it falls back to the infinite readout the slice shipped with.
export function deriveAmmoStatus(me) {
  if (!me || typeof me.m !== 'number') return { weapon: 'Rifle', text: 'INF', status: 'READY' };
  const name = typeof me.w === 'string' && me.w ? me.w[0].toUpperCase() + me.w.slice(1) : 'Rifle';
  let status = 'READY';
  if (me.rel === 1) status = 'RELOADING';
  else if (me.m === 0) status = me.r > 0 ? 'EMPTY' : 'DRY';
  else if (WEAPONS[me.w] && me.m <= Math.ceil(WEAPONS[me.w].magSize * 0.2)) status = 'LOW';
  return { weapon: WEAPONS[me.w]?.name ?? name, text: `${me.m} / ${me.r}`, status };
}

export function deriveTeamColor(playerId, team = -1) {
  if (team === 0) return 'even';
  if (team === 1) return 'odd';
  return playerId % 2 === 0 ? 'even' : 'odd';
}

// SPEC 22: top-centre match line. { timer: 'm:ss', teams: 'Blue 3  Red 5' | '', ending: bool }
export function deriveMatchStatus(match) {
  if (!match) return { timer: '', teams: '', ending: false, objective: '' };
  const endless = match.left < 0; // PRO-audio: practice range
  const left = Math.max(0, match.left | 0);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const teams = Array.isArray(match.ts) ? `Blue ${match.ts[0]}  Red ${match.ts[1]}` : '';
  return { timer: match.phase === 'playing' && !endless ? `${mm}:${ss}` : '', teams, ending: match.phase === 'ending', objective: deriveObjectiveLine(match.obj, match.ts) };
}

// SPEC 39: the objective line under the score. KOTH: who holds the hill and when it moves. CTF: where each flag is.
export function deriveObjectiveLine(obj, ts = null, myTeam = -1) {
  if (!obj) return '';
  if (obj.kind === 'hill') {
    const who = obj.contested ? 'CONTESTED' : obj.holder < 0 ? 'OPEN' : obj.holder === myTeam ? 'HELD BY YOU' : `HELD BY ${TEAM_NAMES[obj.holder].toUpperCase()}`;
    return `HILL ${who}  moves in ${obj.next}s`;
  }
  if (obj.kind === 'flags') {
    const word = (f) => (f.state === 'home' ? 'home' : f.state === 'carried' ? 'TAKEN' : 'dropped');
    return `${TEAM_NAMES[0]} flag ${word(obj.flags[0])}  ${TEAM_NAMES[1]} flag ${word(obj.flags[1])}`;
  }
  void ts;
  return '';
}

// SPEC 22: the end screen headline for a matchEnd message, from the local player's point of view.
export function deriveMatchEndText(m, myId, myTeam = -1) {
  const w = m?.winner;
  if (!w || w.type === 'draw') return 'Draw';
  if (w.type === 'team') return `${w.name} team wins`;
  return w.id === myId ? 'Victory' : `${w.name} wins`;
}

export function sortScoreboardPlayers(players) {
  if (!Array.isArray(players)) return [];
  return [...players].sort((a, b) => b.k - a.k || a.d - b.d || a.id - b.id);
}

// Damage attribution (SPEC 19.1). The server never tells the victim who hit them: the victim only sees
// its hp drop in the next snapshot. The client keeps the recent remote shot origins and explosion
// points as threats; the newest one inside the window is taken as the attacker position.
export const DAMAGE_ATTRIBUTION_MS = 300;

export function pruneThreats(threats, now, windowMs = DAMAGE_ATTRIBUTION_MS) {
  return threats.filter((t) => now - t.at <= windowMs);
}

export function attributeDamage(threats, now, windowMs = DAMAGE_ATTRIBUTION_MS) {
  let best = null;
  for (const t of threats) {
    if (now - t.at > windowMs || now < t.at) continue;
    if (!best || t.at > best.at) best = t;
  }
  return best ? { x: best.x, z: best.z } : null;
}
