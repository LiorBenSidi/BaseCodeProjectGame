// Match modes and the match state machine (docs/SPEC.md section 22, D-021). Pure: time is `nowMs`.

export const MODES = Object.freeze({
  dm: Object.freeze({ id: 'dm', name: 'Deathmatch', teams: false, timeLimitMs: 300_000, scoreLimit: 25 }),
  tdm: Object.freeze({ id: 'tdm', name: 'Team Deathmatch', teams: true, timeLimitMs: 480_000, scoreLimit: 50 }),
  // PRO-audio (SPEC 35.3): the practice range never ends; dummies walk the map and never shoot
  range: Object.freeze({ id: 'range', name: 'Practice Range', teams: false, timeLimitMs: Infinity, scoreLimit: Infinity, practice: true }),
});
export const MODE_IDS = Object.freeze(Object.keys(MODES));
export const DEFAULT_MODE = 'dm';
export const ENDING_MS = 8000; // the end screen stays this long, then the next match starts
// PRO-audio (SPEC 35.3): how many seats bots fill per mode while a human is present, and how they play.
export const BOT_CONFIG = Object.freeze({
  dm: Object.freeze({ fill: 2, difficulty: 'medium' }),
  tdm: Object.freeze({ fill: 4, difficulty: 'medium' }),
  range: Object.freeze({ fill: 4, difficulty: 'dummy' }),
});
export const botConfigFor = (modeId) => BOT_CONFIG[modeId] ?? Object.freeze({ fill: 0, difficulty: 'medium' });

export const TEAM_NAMES = Object.freeze(['Blue', 'Red']);

export function modeDef(id) {
  const d = MODES[id];
  if (!d) throw new RangeError(`unknown mode: ${id}`);
  return d;
}

// phase: 'waiting' (nobody in the room), 'playing', 'ending'.
export function newMatch(modeId = DEFAULT_MODE) {
  const mode = modeDef(modeId);
  return { mode: mode.id, phase: 'waiting', startedAt: -Infinity, endsAt: Infinity, endedAt: -Infinity, teamScores: [0, 0], number: 0 };
}

export function startMatch(m, nowMs) {
  const mode = modeDef(m.mode);
  m.phase = 'playing';
  m.startedAt = nowMs;
  m.endsAt = nowMs + mode.timeLimitMs;
  m.endedAt = -Infinity;
  m.teamScores = [0, 0];
  m.number += 1;
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
export function endMatch(m, players, nowMs, reason) {
  const mode = modeDef(m.mode);
  m.phase = 'ending';
  m.endedAt = nowMs;
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
  return { reason, winner, ranking: ranked, teamScores: [...m.teamScores], number: m.number };
}

export const shouldRestart = (m, nowMs) => m.phase === 'ending' && nowMs >= m.endedAt + ENDING_MS;

// Compact snapshot form.
export function matchSnapshot(m, nowMs) {
  // PRO-audio: an endless mode reports -1 so the HUD shows no timer
  const left = m.phase === 'playing' ? (Number.isFinite(m.endsAt) ? Math.max(0, Math.round((m.endsAt - nowMs) / 1000)) : -1) : 0;
  return { mode: m.mode, phase: m.phase, left, ts: modeDef(m.mode).teams ? [...m.teamScores] : null };
}
