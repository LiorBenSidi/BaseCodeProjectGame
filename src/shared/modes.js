// Match modes and the match state machine (docs/SPEC.md section 22, D-021, D-031). Pure: time is `nowMs`.

export const MODES = Object.freeze({
  dm: Object.freeze({ id: 'dm', name: 'Deathmatch', teams: false, timeLimitMs: 300_000, scoreLimit: 25 }),
  tdm: Object.freeze({ id: 'tdm', name: 'Team Deathmatch', teams: true, timeLimitMs: 480_000, scoreLimit: 50 }),
});
export const MODE_IDS = Object.freeze(Object.keys(MODES));
export const DEFAULT_MODE = 'dm';
export const INTRO_MS = 5000; // 5 s pre-match intro freeze and countdown
export const ENDING_MS = 15000; // 15 s end screen with next-map vote, then restart
export const TEAM_NAMES = Object.freeze(['Blue', 'Red']);

export function modeDef(id) {
  const d = MODES[id];
  if (!d) throw new RangeError(`unknown mode: ${id}`);
  return d;
}

// phase: 'waiting' (nobody in the room), 'intro' (5s pre-match countdown), 'playing', 'ending'.
export function newMatch(modeId = DEFAULT_MODE) {
  const mode = modeDef(modeId);
  return {
    mode: mode.id,
    phase: 'waiting',
    startedAt: -Infinity,
    introEndsAt: -Infinity,
    endsAt: Infinity,
    endedAt: -Infinity,
    teamScores: [0, 0],
    number: 0,
    voteCandidates: [],
    votes: {},
  };
}

// PRO-CEREMONY begin: Match intro and voting helpers
export function startIntro(m, nowMs) {
  const mode = modeDef(m.mode);
  m.phase = 'intro';
  m.introEndsAt = nowMs + INTRO_MS;
  m.startedAt = m.introEndsAt;
  m.endsAt = m.startedAt + mode.timeLimitMs;
  m.endedAt = -Infinity;
  m.teamScores = [0, 0];
  m.number += 1;
  m.voteCandidates = [];
  m.votes = {};
}

export function updateIntroPhase(m, nowMs) {
  if (m.phase === 'intro' && nowMs >= m.introEndsAt) {
    const mode = modeDef(m.mode);
    m.phase = 'playing';
    m.startedAt = nowMs;
    m.endsAt = nowMs + mode.timeLimitMs;
    return true;
  }
  return false;
}

export function recordVote(m, playerId, mapId) {
  if (m.phase === 'ending' && Array.isArray(m.voteCandidates) && m.voteCandidates.includes(mapId)) {
    m.votes[playerId] = mapId;
    return true;
  }
  return false;
}

// The winner of the vote, or null when nobody voted (the rotation then decides). Ties go to the candidate offered
// first, which is the next map in rotation order.
export function tallyVotes(m) {
  if (!Array.isArray(m.voteCandidates) || m.voteCandidates.length === 0) return null;
  const counts = voteCounts(m);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let best = m.voteCandidates[0];
  for (const c of m.voteCandidates) if (counts[c] > counts[best]) best = c;
  return best;
}
// PRO-CEREMONY end

// The first match of a room starts at once (nobody is waiting for anyone); a restart after the end screen runs the
// intro countdown so everyone drops in together (SPEC 34.1). Tests and the first join keep the immediate start.
export function startMatch(m, nowMs, { intro = false } = {}) {
  if (intro) { startIntro(m, nowMs); return; }
  const mode = modeDef(m.mode);
  m.phase = 'playing';
  m.introEndsAt = -Infinity;
  m.startedAt = nowMs;
  m.endsAt = nowMs + mode.timeLimitMs;
  m.endedAt = -Infinity;
  m.teamScores = [0, 0];
  m.number += 1;
  m.voteCandidates = [];
  m.votes = {};
}

// SPEC 34.4: two candidates for the next map vote, never the map just played, in rotation order after it.
export function voteCandidatesFor(mapIds, currentMapId) {
  const others = mapIds.filter((id) => id !== currentMapId);
  return others.slice(0, 2);
}

// Vote counts per candidate for the end screen.
export function voteCounts(m) {
  const counts = {};
  for (const c of m.voteCandidates ?? []) counts[c] = 0;
  for (const id of Object.values(m.votes ?? {})) if (counts[id] !== undefined) counts[id] += 1;
  return counts;
}

// Team for a joining player: the smaller team, ties to Blue (0). DM players have team -1.
export function assignTeam(m, players) {
  if (!modeDef(m.mode).teams) return -1;
  let a = 0;
  let b = 0;
  for (const p of players) if (p.team === 0) a += 1; else if (p.team === 1) b += 1;
  return a <= b ? 0 : 1;
}

export const sameTeam = (a, b) => a.team >= 0 && a.team === b.team;

// Scores a kill. A kill on a teammate or on yourself does not score; in TDM a teammate kill costs the team a point.
export function scoreKill(m, killer, victim) {
  if (!killer || killer === victim) return;
  if (modeDef(m.mode).teams) {
    if (sameTeam(killer, victim)) m.teamScores[killer.team] = Math.max(0, m.teamScores[killer.team] - 1);
    else m.teamScores[killer.team] += 1;
  }
}

// Why the match should end now, or null.
export function endReason(m, players, nowMs) {
  if (m.phase !== 'playing') return null;
  const mode = modeDef(m.mode);
  if (nowMs >= m.endsAt) return 'time';
  if (mode.teams) return m.teamScores.some((s) => s >= mode.scoreLimit) ? 'score' : null;
  for (const p of players) if (p.kills >= mode.scoreLimit) return 'score';
  return null;
}

// Ranking: kills desc, deaths asc, id asc. Pure and stable.
export function ranking(players) {
  return [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
    .map((p) => ({ id: p.id, name: p.name, team: p.team, k: p.kills, d: p.deaths }));
}

// Ends the match and returns the result the room broadcasts.
export function endMatch(m, players, nowMs, reason, voteCandidates = []) {
  const mode = modeDef(m.mode);
  m.phase = 'ending';
  m.endedAt = nowMs;
  m.voteCandidates = Array.isArray(voteCandidates) ? [...voteCandidates] : [];
  m.votes = {};
  const ranked = ranking(players);
  let winner = null;
  if (mode.teams) {
    const [a, b] = m.teamScores;
    winner = a === b ? { type: 'draw' } : { type: 'team', team: a > b ? 0 : 1, name: TEAM_NAMES[a > b ? 0 : 1] };
  } else if (ranked.length > 0) {
    const top = ranked[0];
    const tie = ranked.length > 1 && ranked[1].k === top.k && ranked[1].d === top.d;
    winner = tie ? { type: 'draw' } : { type: 'player', id: top.id, name: top.name };
  } else {
    winner = { type: 'draw' };
  }
  return {
    reason,
    winner,
    ranking: ranked,
    teamScores: [...m.teamScores],
    number: m.number,
    voteCandidates: m.voteCandidates,
  };
}

export const shouldRestart = (m, nowMs) => m.phase === 'ending' && nowMs >= m.endedAt + ENDING_MS;

// Compact snapshot form.
export function matchSnapshot(m, nowMs) {
  let left = 0;
  if (m.phase === 'intro') {
    left = Math.max(0, Math.ceil((m.introEndsAt - nowMs) / 1000));
  } else if (m.phase === 'playing') {
    left = Math.max(0, Math.round((m.endsAt - nowMs) / 1000));
  } else if (m.phase === 'ending') {
    left = Math.max(0, Math.ceil((m.endedAt + ENDING_MS - nowMs) / 1000));
  }
  return {
    mode: m.mode,
    phase: m.phase,
    left,
    ts: modeDef(m.mode).teams ? [...m.teamScores] : null,
    ...(m.phase === 'ending' ? { voteCandidates: m.voteCandidates ?? [] } : {}),
  };
}
