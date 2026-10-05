// SPEC 37.7: the Range reaction station (D-036). In the practice range one dummy becomes the target: it pops up
// at a random spawn, frozen, and the owner has `windowMs` to land a hit. A hit records the reaction time, a miss
// is a timeout. Pure state; GameRoom owns the clock and the bodies.

export const STATION_LEVELS = Object.freeze({
  easy: Object.freeze({ id: 'easy', windowMs: 2500, minM: 8, maxM: 22 }),
  medium: Object.freeze({ id: 'medium', windowMs: 1500, minM: 10, maxM: 28 }),
  hard: Object.freeze({ id: 'hard', windowMs: 900, minM: 12, maxM: 34 }),
});
export const STATION_LEVEL_IDS = Object.freeze(Object.keys(STATION_LEVELS));
export const STATION_GAP_MS = 500; // pause between one target going away and the next popping up
export const STATION_MAX_ROUNDS = 30; // one session; the summary is sent and the station turns itself off

export const isStationLevel = (id) => typeof id === 'string' && Object.hasOwn(STATION_LEVELS, id);

// The next level on a repeated press: off -> easy -> medium -> hard -> off.
export function nextLevel(current) {
  if (!current) return 'easy';
  const i = STATION_LEVEL_IDS.indexOf(current);
  return i < 0 || i === STATION_LEVEL_IDS.length - 1 ? null : STATION_LEVEL_IDS[i + 1];
}

export function newStation(ownerId, level, nowMs) {
  return { ownerId, level, targetId: null, shownAt: -Infinity, nextAt: nowMs + STATION_GAP_MS, hits: 0, misses: 0, times: [], rounds: 0 };
}

// Picks a spawn for the next target: within the level's distance band from the owner, falling back to any spawn
// that is not where the owner stands. `rng` is 0..1.
export function pickTargetSpot(spawns, owner, level, rng = Math.random) {
  const L = STATION_LEVELS[level] ?? STATION_LEVELS.medium;
  const dist = (s) => Math.hypot(s.x - owner.x, s.z - owner.z);
  const band = spawns.filter((s) => dist(s) >= L.minM && dist(s) <= L.maxM);
  const pool = band.length ? band : spawns.filter((s) => dist(s) > 2);
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

// Advances the station clock. Returns one of: null (nothing), { show: true } (time to pop a target),
// { miss: true } (the window closed), { done: true } (session over).
export function stepStation(st, nowMs) {
  if (st.rounds >= STATION_MAX_ROUNDS && st.targetId === null) return { done: true };
  if (st.targetId === null) return nowMs >= st.nextAt ? { show: true } : null;
  const L = STATION_LEVELS[st.level];
  if (nowMs - st.shownAt >= L.windowMs) {
    st.misses += 1; st.rounds += 1; st.targetId = null; st.nextAt = nowMs + STATION_GAP_MS;
    return { miss: true };
  }
  return null;
}

// The owner hit the current target: records the reaction time in ms and clears the target.
export function recordHit(st, nowMs) {
  const ms = Math.max(0, Math.round(nowMs - st.shownAt));
  st.hits += 1; st.rounds += 1; st.times.push(ms); st.targetId = null; st.nextAt = nowMs + STATION_GAP_MS;
  return ms;
}

export function stationSummary(st) {
  const n = st.times.length;
  const avg = n ? Math.round(st.times.reduce((a, b) => a + b, 0) / n) : null;
  const best = n ? Math.min(...st.times) : null;
  return { level: st.level, hits: st.hits, misses: st.misses, rounds: st.rounds, avgMs: avg, bestMs: best, lastMs: n ? st.times[n - 1] : null };
}
