// Pure combat-feedback helpers (docs/SPEC.md §15.5, D-013). Everything here is derived from server
// messages (`verdict`, `boom`); nothing the client predicted is ever reported as a confirmed hit.

export const LOG_LIMIT = 8;

const ZONE_LABELS = { head: 'head', upperTorso: 'upper torso', lowerTorso: 'lower torso', arms: 'arm', legs: 'leg' };

export function markerKind(v) {
  if (!v || v.target === null) return null;
  return v.zone === 'head' ? 'head' : 'body';
}

export function formatVerdict(v, nameOf) {
  if (v.target === null) return `MISS · ${v.dist} m`;
  const text = `HIT ${nameOf(v.target)} · ${ZONE_LABELS[v.zone] ?? 'body'} · ${v.dmg} dmg · ${v.dist} m`;
  return v.kill ? `${text} · KILL` : text;
}

// Returns null when the blast neither came from me nor touched me.
export function formatBoom(b, myId, nameOf) {
  const kill = (h) => (h.kill ? ' KILL' : '');
  if (b.owner === myId) {
    if (b.hits.length === 0) return 'GRENADE · no hits';
    return `GRENADE · ${b.hits.map((h) => `${h.id === myId ? 'self' : nameOf(h.id)} ${h.dmg}${kill(h)}`).join(', ')}`;
  }
  const mine = b.hits.find((h) => h.id === myId);
  return mine ? `GRENADE from ${nameOf(b.owner)} · you took ${mine.dmg}${kill(mine)}` : null;
}

export class CombatLog {
  #entries = [];

  push(text) {
    if (!text) return;
    this.#entries.push(text);
    if (this.#entries.length > LOG_LIMIT) this.#entries.splice(0, this.#entries.length - LOG_LIMIT);
  }

  get entries() {
    return [...this.#entries];
  }
}
