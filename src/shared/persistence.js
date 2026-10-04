// Match results and player stats as entity payloads (docs/SPEC.md section 27, D-024). Pure.
// The actor writes these with its service role; only players with a platform-verified userId get a
// PlayerStats row, so a callsign typed into the menu can never credit someone else's account.

export const STATS_FIELDS = Object.freeze(['kills', 'deaths', 'assists_xp', 'matches', 'wins', 'best_kills', 'xp']);

// One MatchResult record. `players` are the room's player objects at match end.
export function matchResultRecord({ roomId, mode, result, players, nowMs }) {
  return {
    room_id: roomId,
    mode,
    match_number: result.number | 0,
    reason: String(result.reason),
    winner: result.winner ? { type: result.winner.type, ...(result.winner.name ? { name: result.winner.name } : {}), ...(typeof result.winner.team === 'number' ? { team: result.winner.team } : {}) } : { type: 'draw' },
    team_scores: result.teamScores ?? null,
    players: players.map((p) => ({ name: p.name, user_id: p.userId ?? null, kills: p.kills | 0, deaths: p.deaths | 0, team: p.team ?? -1, xp: p.progress?.xp | 0, level: p.progress?.level | 0 })),
    ended_at: new Date(nowMs).toISOString(),
  };
}

// Whether this player won: by id in DM, by team in TDM; a draw wins for nobody.
export function playerWon(result, p) {
  const w = result.winner;
  if (!w || w.type === 'draw') return false;
  if (w.type === 'player') return w.id === p.id;
  if (w.type === 'team') return p.team === w.team;
  return false;
}

// Per-player deltas to add to their PlayerStats row. Anonymous players are skipped.
export function statsDeltas({ result, players, nowMs }) {
  const out = [];
  for (const p of players) {
    if (!p.userId) continue;
    out.push({
      user_id: p.userId,
      name: String(p.name ?? '').slice(0, 16),
      kills: p.kills | 0,
      deaths: p.deaths | 0,
      xp: p.progress?.xp | 0,
      matches: 1,
      wins: playerWon(result, p) ? 1 : 0,
      best_kills: p.kills | 0,
      last_played: new Date(nowMs).toISOString(),
    });
  }
  return out;
}

// Merge a delta into an existing row (or a fresh one). Totals add, best_kills is a max, name is latest.
export function mergeStats(row, d) {
  const r = row ?? { user_id: d.user_id, kills: 0, deaths: 0, xp: 0, matches: 0, wins: 0, best_kills: 0 };
  return {
    user_id: d.user_id,
    name: d.name,
    kills: (r.kills | 0) + d.kills,
    deaths: (r.deaths | 0) + d.deaths,
    xp: (r.xp | 0) + d.xp,
    matches: (r.matches | 0) + d.matches,
    wins: (r.wins | 0) + d.wins,
    best_kills: Math.max(r.best_kills | 0, d.best_kills),
    last_played: d.last_played,
  };
}

// Leaderboard view: top N by kills, then wins, then fewer deaths.
export function leaderboard(rows, n = 10) {
  return (rows ?? [])
    .filter((r) => r && typeof r.user_id === 'string')
    .sort((a, b) => (b.kills | 0) - (a.kills | 0) || (b.wins | 0) - (a.wins | 0) || (a.deaths | 0) - (b.deaths | 0))
    .slice(0, n)
    .map((r, i) => ({ rank: i + 1, name: r.name || 'Player', kills: r.kills | 0, deaths: r.deaths | 0, wins: r.wins | 0, matches: r.matches | 0, kd: (r.kills | 0) / Math.max(1, r.deaths | 0) }));
}
