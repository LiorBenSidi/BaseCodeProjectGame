// Ceremony, medals, kill cam and minimap math (SPEC 34, D-031). Pure: hud.js and game.js apply the numbers.
import { MEDALS, medalCount } from '../shared/medals.js';
import { RESPAWN_MS } from '../shared/constants.js';

// SPEC 34.1: intro countdown text from the seconds left in the snapshot.
export function introText(left) {
  if (!(left > 0)) return 'GO';
  return String(Math.ceil(left));
}

// SPEC 34.2: podium rows for the end screen. `medals` is { playerId: { medalId: n } } from matchEnd.
export function podium(ranking = [], medals = {}, myId = null, n = 3) {
  return ranking.slice(0, n).map((r, i) => ({
    rank: i + 1,
    id: r.id,
    name: r.name,
    k: r.k ?? 0,
    d: r.d ?? 0,
    kd: (r.d ?? 0) === 0 ? (r.k ?? 0).toFixed(2) : ((r.k ?? 0) / r.d).toFixed(2),
    medals: medalCount(medals[r.id]),
    me: r.id === myId,
  }));
}

// The MVP is the top ranked player; in a draw with no players, null.
export const mvp = (ranking = []) => ranking[0] ?? null;

// My medal lines for the end screen: [{ id, name, short, count }] sorted by count then name.
export function medalLines(medals = {}, myId) {
  const mine = medals[myId] ?? {};
  return Object.entries(mine)
    .filter(([id]) => MEDALS[id])
    .map(([id, count]) => ({ id, name: MEDALS[id].name, short: MEDALS[id].short, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// SPEC 34.4: vote buttons. names maps map id to display name; counts from the vote broadcast; mine my current vote.
export function voteView(candidates = [], counts = {}, mine = null, names = {}) {
  const total = candidates.reduce((a, c) => a + (counts[c] ?? 0), 0);
  return candidates.map((id, i) => ({ id, key: i + 1, name: names[id] ?? id, votes: counts[id] ?? 0, share: total ? (counts[id] ?? 0) / total : 0, mine: id === mine }));
}

// SPEC 34.5 kill cam: replay window. The cam shows the killer's last 2.5 s up to the kill, and runs until just
// before the respawn so the player is back in control when they come alive.
export const KILLCAM_LOOKBACK_MS = 2500;
export function killcamWindow(killTime, respawnMs = RESPAWN_MS) {
  const duration = Math.max(0, Math.min(KILLCAM_LOOKBACK_MS, respawnMs - 500));
  return { from: killTime - duration, to: killTime, duration };
}

// Interpolated sample of a killer's history [{ t, x, y, z, yaw, pitch, h }] at time t (clamped to the ends).
export function killcamSample(history, t) {
  if (!history || history.length === 0) return null;
  if (t <= history[0].t) return { ...history[0] };
  const last = history[history.length - 1];
  if (t >= last.t) return { ...last };
  let lo = 0, hi = history.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (history[mid].t <= t) lo = mid; else hi = mid; }
  const a = history[lo], b = history[hi];
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const lerp = (p, q) => p + (q - p) * k;
  let dy = b.yaw - a.yaw;
  dy = ((((dy + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { t, x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z), yaw: a.yaw + dy * k, pitch: lerp(a.pitch, b.pitch), h: lerp(a.h ?? 1.8, b.h ?? 1.8) };
}

// Trim a history to the last `keepMs` before `now`.
export function trimHistory(history, now, keepMs = 6000) {
  let i = 0;
  while (i < history.length - 1 && history[i + 1].t < now - keepMs) i += 1;
  if (i > 0) history.splice(0, i);
  return history;
}

// SPEC 34.6 minimap: north-up projection of the map and the players into a square canvas of `size` px.
// Enemies appear only when `revealed` (fired within the last 2 s or within 12 m); allies always.
export const MINIMAP_REVEAL_MS = 2000;
export const MINIMAP_NEAR_M = 12;
export function minimapLayout(map, me, others, size, { now = 0, team = -1, lastShotAt = new Map() } = {}) {
  const half = map?.half ?? 20;
  const s = size / (half * 2);
  const px = (x) => (x + half) * s;
  const pz = (z) => (z + half) * s;
  // boxes are { min: [x, y, z], max: [x, y, z] } (map.js); low props stay off the map, tall cover is drawn darker
  const boxes = (map?.boxes ?? []).filter((b) => b.max[1] - b.min[1] >= 0.8).map((b) => ({ x: px(b.min[0]), y: pz(b.min[2]), w: (b.max[0] - b.min[0]) * s, h: (b.max[2] - b.min[2]) * s, tall: b.max[1] - b.min[1] >= 2.5 }));
  const dots = [];
  for (const o of others) {
    if (o.alive === 0) continue;
    const ally = team >= 0 && o.team === team;
    const near = Math.hypot(o.x - me.x, o.z - me.z) <= MINIMAP_NEAR_M;
    const fired = now - (lastShotAt.get(o.id) ?? -Infinity) <= MINIMAP_REVEAL_MS;
    if (!ally && !near && !fired) continue;
    dots.push({ id: o.id, x: px(o.x), y: pz(o.z), kind: ally ? 'ally' : 'enemy', yaw: o.yaw ?? 0 });
  }
  return { size, boxes, me: { x: px(me.x), y: pz(me.z), yaw: me.yaw ?? 0 }, dots };
}
