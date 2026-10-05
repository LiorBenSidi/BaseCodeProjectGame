// SPEC 39.8 (D-038): the ping wheel. Pure rules shared by server and client. A mark is a world point plus a kind;
// the server relays it to the sender's team (to the sender alone without teams), rate limited, never stored.

export const MARK_KINDS = Object.freeze({
  go: Object.freeze({ id: 'go', label: 'On my way', text: 'On my way', color: '#5ce1ff', ttlMs: 6000 }),
  danger: Object.freeze({ id: 'danger', label: 'Danger', text: 'Danger here', color: '#ff5252', ttlMs: 8000 }),
  watch: Object.freeze({ id: 'watch', label: 'Watch here', text: 'Watch this spot', color: '#ffb347', ttlMs: 8000 }),
  enemy: Object.freeze({ id: 'enemy', label: 'Enemy', text: 'Enemy spotted', color: '#ff5252', ttlMs: 5000 }),
  help: Object.freeze({ id: 'help', label: 'Need help', text: 'Need help', color: '#3ddc84', ttlMs: 8000 }),
  defend: Object.freeze({ id: 'defend', label: 'Defend', text: 'Defend here', color: '#8fd3ff', ttlMs: 10000 }),
  attack: Object.freeze({ id: 'attack', label: 'Attack', text: 'Attack here', color: '#ffd27a', ttlMs: 10000 }),
  thanks: Object.freeze({ id: 'thanks', label: 'Thanks', text: 'Thanks', color: '#e6edf3', ttlMs: 3000 }),
});
export const MARK_IDS = Object.freeze(Object.keys(MARK_KINDS));
export const WHEEL_ORDER = Object.freeze(['go', 'enemy', 'danger', 'attack', 'thanks', 'defend', 'help', 'watch']); // clockwise from the top
export const WHEEL_HOLD_MS = 220; // shorter press = quick ping at the aim point
export const MARK_MIN_INTERVAL_MS = 700; // per player
export const MARK_MAX_LIVE = 3; // per sender; the oldest is replaced
export const MARK_RANGE_M = 80;
export const isMarkKind = (id) => typeof id === 'string' && Object.hasOwn(MARK_KINDS, id);

// Validates a mark from the wire: kind and a finite point inside a generous arena bound.
export function sanitizeMark(kind, at) {
  if (!isMarkKind(kind) || !Array.isArray(at) || at.length !== 3) return null;
  const [x, y, z] = at.map(Number);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 120 || Math.abs(z) > 120 || y < -5 || y > 60) return null;
  return { kind, at: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10] };
}

export const markAllowed = (lastAt, nowMs) => nowMs - lastAt >= MARK_MIN_INTERVAL_MS;

// The quick (tap) kind: an enemy under the crosshair pings "enemy", otherwise "watch".
export const quickKind = (enemyUnderAim) => (enemyUnderAim ? 'enemy' : 'watch');

// Wheel pick from the pointer offset accumulated while the key is held. Inside the dead zone nothing is picked.
export function wheelPick(dx, dy, deadZone = 18) {
  const r = Math.hypot(dx, dy);
  if (r < deadZone) return null;
  const n = WHEEL_ORDER.length;
  const angle = Math.atan2(dx, -dy); // 0 = up, clockwise positive
  const idx = Math.round((angle / (2 * Math.PI)) * n);
  return WHEEL_ORDER[((idx % n) + n) % n];
}

// Live marks list: add one for a sender, drop that sender's oldest beyond MARK_MAX_LIVE, expire by ttl.
export function addMark(list, mark, nowMs) {
  const kind = MARK_KINDS[mark.kind];
  const mine = list.filter((m) => m.from === mark.from);
  if (mine.length >= MARK_MAX_LIVE) { const oldest = mine.reduce((a, b) => (a.at < b.at ? a : b)); list.splice(list.indexOf(oldest), 1); }
  list.push({ ...mark, at: nowMs, until: nowMs + kind.ttlMs });
  return list;
}
export const pruneMarks = (list, nowMs) => { for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].until <= nowMs) list.splice(i, 1); return list; };

export const markFeedText = (name, kind) => `${name}: ${MARK_KINDS[kind]?.text ?? kind}`;
