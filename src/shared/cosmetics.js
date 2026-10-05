// Cosmetics unlocked by lifetime stats (SPEC 40.1, 40.2, D-039). Pure: the catalog, the unlock rules and the
// server side validation. Nothing here changes gameplay: a badge is a glyph in front of the name, an accent is
// the name tag colour, a tracer is the colour of the player's own shot lines. The server resolves every
// selection against the PlayerStats row it loaded itself (hooks.statsFor), never against anything the client
// claims, so a locked item can never appear on another player's screen.

// Slot order is the wire order of the snapshot field `cs: [badge, accent, tracer]` (catalog indexes; append only).
export const SLOTS = Object.freeze(['badge', 'accent', 'tracer']);

export const CATALOG = Object.freeze({
  badge: Object.freeze([
    Object.freeze({ id: 'none', name: 'No badge', glyph: '', unlock: null }),
    Object.freeze({ id: 'rookie', name: 'Rookie', glyph: '\u25E6', unlock: Object.freeze({ stat: 'matches', min: 1 }) }),
    Object.freeze({ id: 'veteran', name: 'Veteran', glyph: '\u25C6', unlock: Object.freeze({ stat: 'matches', min: 25 }) }),
    Object.freeze({ id: 'marksman', name: 'Marksman', glyph: '\u2726', unlock: Object.freeze({ stat: 'kills', min: 100 }) }),
    Object.freeze({ id: 'ace', name: 'Ace', glyph: '\u2605', unlock: Object.freeze({ stat: 'best_kills', min: 20 }) }),
    Object.freeze({ id: 'champion', name: 'Champion', glyph: '\u265B', unlock: Object.freeze({ stat: 'wins', min: 10 }) }),
    Object.freeze({ id: 'legend', name: 'Legend', glyph: '\u263C', unlock: Object.freeze({ stat: 'xp', min: 10_000 }) }),
  ]),
  accent: Object.freeze([
    Object.freeze({ id: 'team', name: 'Team colour', hex: null, unlock: null }),
    Object.freeze({ id: 'ember', name: 'Ember', hex: '#ff7a45', unlock: Object.freeze({ stat: 'kills', min: 25 }) }),
    Object.freeze({ id: 'frost', name: 'Frost', hex: '#7fd8ff', unlock: Object.freeze({ stat: 'matches', min: 10 }) }),
    Object.freeze({ id: 'gold', name: 'Gold', hex: '#ffd23f', unlock: Object.freeze({ stat: 'wins', min: 5 }) }),
    Object.freeze({ id: 'violet', name: 'Violet', hex: '#c17bff', unlock: Object.freeze({ stat: 'xp', min: 2500 }) }),
    Object.freeze({ id: 'mint', name: 'Mint', hex: '#5cf2b0', unlock: Object.freeze({ stat: 'kills', min: 250 }) }),
  ]),
  tracer: Object.freeze([
    Object.freeze({ id: 'standard', name: 'Standard', hex: '#ffe08a', unlock: null }),
    Object.freeze({ id: 'crimson', name: 'Crimson', hex: '#ff4d4d', unlock: Object.freeze({ stat: 'kills', min: 50 }) }),
    Object.freeze({ id: 'plasma', name: 'Plasma', hex: '#6ad1ff', unlock: Object.freeze({ stat: 'xp', min: 1000 }) }),
    Object.freeze({ id: 'venom', name: 'Venom', hex: '#8cff5c', unlock: Object.freeze({ stat: 'best_kills', min: 10 }) }),
    Object.freeze({ id: 'solar', name: 'Solar', hex: '#ffffff', unlock: Object.freeze({ stat: 'wins', min: 20 }) }),
  ]),
});

export const DEFAULT_COSMETICS = Object.freeze({ badge: 'none', accent: 'team', tracer: 'standard' });
export const STAT_LABELS = Object.freeze({ matches: 'matches played', kills: 'kills', best_kills: 'best kills in a match', wins: 'wins', xp: 'XP' });

export const itemOf = (slot, id) => CATALOG[slot]?.find((it) => it.id === id) ?? null;

// Free items need no stats; everything else needs the row to carry at least `min` of the stat.
export function isUnlocked(item, stats) {
  if (!item) return false;
  if (!item.unlock) return true;
  const v = Number(stats?.[item.unlock.stat]);
  return Number.isFinite(v) && v >= item.unlock.min;
}

// 'Unlock: 25 kills (12/25)' for the picker; '' for a free item.
export function unlockText(item, stats = null) {
  if (!item?.unlock) return '';
  const have = Math.max(0, Number(stats?.[item.unlock.stat]) || 0);
  return `Unlock: ${item.unlock.min} ${STAT_LABELS[item.unlock.stat]} (${Math.min(have, item.unlock.min)}/${item.unlock.min})`;
}

// The selection a player is allowed: unknown or locked ids fall back to the slot default. Always a full object.
export function resolveCosmetics(wish, stats = null) {
  const out = {};
  for (const slot of SLOTS) {
    const it = itemOf(slot, wish?.[slot]);
    out[slot] = it && isUnlocked(it, stats) ? it.id : DEFAULT_COSMETICS[slot];
  }
  return out;
}

export const isDefault = (cs) => SLOTS.every((s) => (cs?.[s] ?? DEFAULT_COSMETICS[s]) === DEFAULT_COSMETICS[s]);

// Wire form: catalog indexes in slot order; null when everything is default so the snapshot stays small.
export function packCosmetics(cs) {
  if (isDefault(cs)) return null;
  return SLOTS.map((s) => Math.max(0, CATALOG[s].findIndex((it) => it.id === cs[s])));
}
export function unpackCosmetics(arr) {
  const out = { ...DEFAULT_COSMETICS };
  if (!Array.isArray(arr)) return out;
  SLOTS.forEach((s, i) => { const it = CATALOG[s][arr[i] | 0]; if (it) out[s] = it.id; });
  return out;
}

// Display helpers (client). Badge glyph before the name; accent hex or null for the team colour; tracer colour.
export const badgeGlyph = (cs) => itemOf('badge', cs?.badge ?? 'none')?.glyph ?? '';
export const displayName = (name, cs) => { const g = badgeGlyph(cs); return g ? `${g} ${name}` : name; };
export const accentHex = (cs) => itemOf('accent', cs?.accent ?? 'team')?.hex ?? null;
export const tracerHex = (cs) => itemOf('tracer', cs?.tracer ?? 'standard')?.hex ?? CATALOG.tracer[0].hex;

// Everything a stats row unlocks, for the lobby picker and the tests.
export function unlockedIds(stats) {
  const out = {};
  for (const s of SLOTS) out[s] = CATALOG[s].filter((it) => isUnlocked(it, stats)).map((it) => it.id);
  return out;
}

// A client selection as received on the wire: strings only, unknown keys dropped. Never throws.
export function sanitizeWish(raw) {
  const out = {};
  for (const s of SLOTS) if (typeof raw?.[s] === 'string' && raw[s].length <= 24) out[s] = raw[s];
  return out;
}
