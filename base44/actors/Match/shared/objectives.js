// Objective modes (docs/SPEC.md section 39, D-038). Pure: time is `nowMs`, callers pass player lists.
//
// KOTH ("King of the Hill"): one hill at a time, taken from the map's `hills` list, rotating every HILL_ROTATE_MS.
// A team holds the hill when it has living players inside and the other team has none; a held hill scores
// HILL_POINTS_PER_SEC for the holder. Both teams inside = contested, nobody scores.
//
// CTF ("Capture the Flag"): each team has a base (map `bases`). Touching the enemy flag at its base or on the
// ground picks it up; carrying it into your own base while your own flag is home scores a capture. A carrier's death
// drops the flag where they fell; it returns home after FLAG_RETURN_MS on the ground, or when a defender touches it.

export const HILL_ROTATE_MS = 60_000;
export const HILL_RADIUS = 5;
export const HILL_POINTS_PER_SEC = 1;
export const FLAG_RETURN_MS = 20_000;
export const FLAG_PICK_RADIUS = 1.6;
export const BASE_RADIUS = 3;
export const CTF_CAPTURE_POINTS = 1;

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// ---- KOTH ----

export function newHillState(map, nowMs) {
  const hills = map.hills ?? [];
  return { index: 0, hills, rotateAt: nowMs + HILL_ROTATE_MS, holder: -1, contested: false, acc: [0, 0] };
}

export const currentHill = (h) => h.hills[h.index] ?? null;

export const inHill = (hill, p) => !!hill && p.alive && dist2(hill, p) <= HILL_RADIUS * HILL_RADIUS;

// Advances the hill by dtMs. Returns the points to add per team, [blue, red] (whole points only).
export function stepHill(h, players, nowMs, dtMs) {
  const points = [0, 0];
  if (h.hills.length === 0) return points;
  if (nowMs >= h.rotateAt) {
    h.index = (h.index + 1) % h.hills.length;
    h.rotateAt = nowMs + HILL_ROTATE_MS;
    h.acc = [0, 0];
  }
  const hill = currentHill(h);
  const inside = [0, 0];
  for (const p of players) if (p.team >= 0 && inHill(hill, p)) inside[p.team] += 1;
  h.contested = inside[0] > 0 && inside[1] > 0;
  h.holder = h.contested ? -1 : inside[0] > 0 ? 0 : inside[1] > 0 ? 1 : -1;
  if (h.holder >= 0) {
    h.acc[h.holder] += (dtMs / 1000) * HILL_POINTS_PER_SEC;
    const whole = Math.floor(h.acc[h.holder] + 1e-3); // 1 ms of slack: 90 ticks of 33.33 ms count as the 3 s they are
    if (whole > 0) { points[h.holder] = whole; h.acc[h.holder] -= whole; }
  }
  return points;
}

export function hillSnapshot(h, nowMs) {
  const hill = currentHill(h);
  if (!hill) return null;
  return { kind: 'hill', x: hill.x, z: hill.z, r: HILL_RADIUS, holder: h.holder, contested: h.contested, next: Math.max(0, Math.ceil((h.rotateAt - nowMs) / 1000)) };
}

// ---- CTF ----

// flags[t]: the flag of team t. state: 'home' | 'carried' | 'dropped'.
export function newFlagState(map) {
  const bases = map.bases ?? [];
  return {
    bases,
    flags: bases.map((b, t) => ({ team: t, state: 'home', x: b.x, z: b.z, carrier: null, droppedAt: -Infinity })),
  };
}

const atBase = (base, p) => dist2(base, p) <= BASE_RADIUS * BASE_RADIUS;

// Advances flags. Returns { points: [blue, red], events: [{ type, team, by, name }] }.
// type: 'take' (picked up at the base), 'pickup' (from the ground), 'drop', 'return', 'capture'.
export function stepFlags(f, players, nowMs) {
  const points = [0, 0];
  const events = [];
  if (f.bases.length < 2) return { points, events };
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const flag of f.flags) {
    const enemyTeam = 1 - flag.team;
    if (flag.state === 'carried') {
      const c = byId.get(flag.carrier);
      if (!c || !c.alive) {
        flag.state = 'dropped';
        flag.droppedAt = nowMs;
        if (c) { flag.x = c.x; flag.z = c.z; }
        events.push({ type: 'drop', team: flag.team, by: flag.carrier, name: c?.name ?? '' });
        flag.carrier = null;
        continue;
      }
      flag.x = c.x; flag.z = c.z;
      const ownFlag = f.flags[enemyTeam];
      if (atBase(f.bases[enemyTeam], c) && ownFlag.state === 'home') {
        points[enemyTeam] += CTF_CAPTURE_POINTS;
        events.push({ type: 'capture', team: enemyTeam, by: c.id, name: c.name });
        flag.state = 'home'; flag.x = f.bases[flag.team].x; flag.z = f.bases[flag.team].z; flag.carrier = null;
      }
      continue;
    }
    if (flag.state === 'dropped' && nowMs - flag.droppedAt >= FLAG_RETURN_MS) {
      flag.state = 'home'; flag.x = f.bases[flag.team].x; flag.z = f.bases[flag.team].z;
      events.push({ type: 'return', team: flag.team, by: null, name: '' });
      continue;
    }
    // Who touches it first: the player list order is stable (by id), so this is deterministic.
    for (const p of players) {
      if (!p.alive || p.team < 0 || dist2(flag, p) > FLAG_PICK_RADIUS * FLAG_PICK_RADIUS) continue;
      if (p.team === enemyTeam) {
        events.push({ type: flag.state === 'home' ? 'take' : 'pickup', team: flag.team, by: p.id, name: p.name });
        flag.state = 'carried'; flag.carrier = p.id; flag.x = p.x; flag.z = p.z;
        break;
      }
      if (flag.state === 'dropped') {
        flag.state = 'home'; flag.x = f.bases[flag.team].x; flag.z = f.bases[flag.team].z;
        events.push({ type: 'return', team: flag.team, by: p.id, name: p.name });
        break;
      }
    }
  }
  return { points, events };
}

export const carrying = (f, playerId) => f.flags.find((fl) => fl.state === 'carried' && fl.carrier === playerId) ?? null;

export function flagsSnapshot(f) {
  if (f.bases.length < 2) return null;
  return {
    kind: 'flags',
    bases: f.bases.map((b) => ({ x: b.x, z: b.z, r: BASE_RADIUS })),
    flags: f.flags.map((fl) => ({ team: fl.team, state: fl.state, x: Math.round(fl.x * 10) / 10, z: Math.round(fl.z * 10) / 10, carrier: fl.carrier })),
  };
}

// Feed text for a flag event, from the viewpoint of nobody in particular.
export function flagEventText(e, teamNames) {
  const flagOf = `${teamNames[e.team]} flag`;
  switch (e.type) {
    case 'take': return `${e.name} took the ${flagOf}`;
    case 'pickup': return `${e.name} picked up the ${flagOf}`;
    case 'drop': return `${e.name} dropped the ${flagOf}`;
    case 'return': return e.name ? `${e.name} returned the ${flagOf}` : `The ${flagOf} returned home`;
    case 'capture': return `${e.name} captured the ${teamNames[1 - e.team]} flag`;
    default: return '';
  }
}
