// Medals (SPEC 34.3, D-031). Pure: the room feeds authoritative kills and the tracker decides what was earned. Kill
// medals are returned as ids and broadcast with the kill; `matchEndMedals` adds Flawless and returns the totals for
// the end screen. Times come from the caller (nowMs), so the tests are deterministic.

export const MEDALS = Object.freeze({
  first_blood: Object.freeze({ id: 'first_blood', name: 'First Blood', short: 'FB', desc: 'First kill of the match' }),
  double: Object.freeze({ id: 'double', name: 'Double Kill', short: 'x2', desc: 'Two kills within 4 seconds' }),
  triple: Object.freeze({ id: 'triple', name: 'Triple Kill', short: 'x3', desc: 'Three kills within 4 seconds' }),
  quad: Object.freeze({ id: 'quad', name: 'Quad Kill', short: 'x4', desc: 'Four kills within 4 seconds' }),
  headshot: Object.freeze({ id: 'headshot', name: 'Headshot', short: 'HS', desc: 'Kill with a head hit' }),
  longshot: Object.freeze({ id: 'longshot', name: 'Longshot', short: 'LS', desc: 'Kill from 30 m or more' }),
  pointblank: Object.freeze({ id: 'pointblank', name: 'Point Blank', short: 'PB', desc: 'Kill from under 2 m' }),
  revenge: Object.freeze({ id: 'revenge', name: 'Revenge', short: 'RV', desc: 'Eliminated the player who last killed you' }),
  comeback: Object.freeze({ id: 'comeback', name: 'Comeback', short: 'CB', desc: 'A kill after three deaths in a row' }),
  buzzkill: Object.freeze({ id: 'buzzkill', name: 'Buzzkill', short: 'BZ', desc: 'Ended a streak of 5 or more' }),
  flawless: Object.freeze({ id: 'flawless', name: 'Flawless', short: 'FL', desc: 'Three or more kills and no deaths in a match' }),
});
export const MEDAL_IDS = Object.freeze(Object.keys(MEDALS));
export const MULTI_KILL_MS = 4000;
export const LONGSHOT_M = 30;
export const POINTBLANK_M = 2;
export const BUZZKILL_STREAK = 5;
export const FLAWLESS_KILLS = 3;

export function newMedalTracker() {
  return { firstBlood: false, players: new Map() };
}

function stateOf(tracker, id) {
  let p = tracker.players.get(id);
  if (!p) {
    p = { lastKilledBy: null, deathsSinceKill: 0, streak: 0, recentKills: [], medals: {} };
    tracker.players.set(id, p);
  }
  return p;
}

const award = (state, id, out) => { state.medals[id] = (state.medals[id] ?? 0) + 1; out.push(id); };

// One authoritative kill. Returns the medal ids the killer earned (possibly empty). Self kills earn nothing but
// still count as a death for the victim's comeback and revenge state.
export function recordKillMedals(tracker, { killerId, victimId, isHeadshot = false, nowMs = 0, dist = NaN }) {
  const victim = stateOf(tracker, victimId);
  const victimStreak = victim.streak;
  victim.streak = 0;
  victim.deathsSinceKill += 1;
  victim.recentKills = [];
  if (!killerId || killerId === victimId) { victim.lastKilledBy = null; return []; }
  victim.lastKilledBy = killerId;
  const killer = stateOf(tracker, killerId);
  const out = [];
  if (!tracker.firstBlood) { tracker.firstBlood = true; award(killer, 'first_blood', out); }
  killer.recentKills = killer.recentKills.filter((t) => nowMs - t < MULTI_KILL_MS);
  killer.recentKills.push(nowMs);
  const n = killer.recentKills.length;
  if (n === 2) award(killer, 'double', out);
  else if (n === 3) award(killer, 'triple', out);
  else if (n >= 4) award(killer, 'quad', out);
  if (isHeadshot) award(killer, 'headshot', out);
  if (Number.isFinite(dist) && dist >= LONGSHOT_M) award(killer, 'longshot', out);
  else if (Number.isFinite(dist) && dist < POINTBLANK_M) award(killer, 'pointblank', out);
  if (killer.lastKilledBy === victimId) { award(killer, 'revenge', out); killer.lastKilledBy = null; }
  if (killer.deathsSinceKill >= 3) award(killer, 'comeback', out);
  killer.deathsSinceKill = 0;
  if (victimStreak >= BUZZKILL_STREAK) award(killer, 'buzzkill', out);
  killer.streak += 1;
  return out;
}

// End of match: Flawless for every player with FLAWLESS_KILLS kills and no deaths. Returns { playerId: { medalId: n } }
// for everyone who earned anything, for the ceremony screen.
export function matchEndMedals(tracker, players) {
  const totals = {};
  for (const p of players) {
    if (p.deaths === 0 && p.kills >= FLAWLESS_KILLS) stateOf(tracker, p.id).medals.flawless = 1;
  }
  for (const [id, st] of tracker.players) if (Object.keys(st.medals).length) totals[id] = { ...st.medals };
  return totals;
}

export const medalCount = (medals) => Object.values(medals ?? {}).reduce((a, b) => a + b, 0);
