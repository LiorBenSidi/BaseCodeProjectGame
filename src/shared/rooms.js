// Room ids, codes and the lobby registry shapes (docs/SPEC.md section 26, D-024). Pure.
// A room id is `<mode>-<code>`: the mode is part of the id because the actor learns nothing about a
// room except its instance id, and the first joiner's choice must bind everyone who follows.
import { MODE_IDS, DEFAULT_MODE } from './modes.js';

export const LEGACY_ROOM_ID = 'arena-1'; // the pre-lobby default room, a deathmatch
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i, l, o, 0, 1
export const ROOM_CODE_LENGTH = 6;
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // what the transport accepts (printable, no '/')
export const ROOM_STALE_MS = 120_000; // a registry row older than this is a room that went to sleep

export function newRoomCode(random = Math.random, length = ROOM_CODE_LENGTH) {
  let s = '';
  for (let i = 0; i < length; i++) s += ROOM_CODE_ALPHABET[Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(random() * ROOM_CODE_ALPHABET.length))];
  return s;
}

export const makeRoomId = (mode, code) => `${mode}-${code}`;

// { mode, code } for a lobby room, the legacy room, or a diag room; null for anything else.
export function parseRoomId(id) {
  if (typeof id !== 'string' || !ROOM_ID_RE.test(id)) return null;
  if (id === LEGACY_ROOM_ID) return { mode: DEFAULT_MODE, code: id };
  if (id.startsWith('diag-')) return { mode: DEFAULT_MODE, code: id };
  const dash = id.indexOf('-');
  if (dash <= 0) return null;
  const mode = id.slice(0, dash);
  const code = id.slice(dash + 1);
  if (!MODE_IDS.includes(mode) || !/^[a-z0-9]{4,12}$/.test(code)) return null;
  return { mode, code };
}

export const isRoomId = (id) => parseRoomId(id) !== null;

// The mode an actor instance runs: from its id, the default when the id is not a lobby id.
export const modeForRoomId = (id) => parseRoomId(id)?.mode ?? DEFAULT_MODE;

// `?room=<id>` from the page URL, else the fallback. Anything that is not a room id falls back too.
export function roomIdFromLocation(search, fallback = LEGACY_ROOM_ID) {
  const raw = new URLSearchParams(search ?? '').get('room');
  return raw && isRoomId(raw) ? raw : fallback;
}

// A shareable join link for a room id.
export const roomLink = (origin, id) => `${origin}/?room=${encodeURIComponent(id)}`;

// Registry row (entity Room) written by the actor on persistence paths only.
export function roomRow({ roomId, mode, players, maxPlayers, phase, matchNumber, nowMs }) {
  return {
    room_id: roomId,
    mode,
    players: players | 0,
    max_players: maxPlayers | 0,
    phase: String(phase),
    match_number: matchNumber | 0,
    status: players <= 0 ? 'empty' : players >= maxPlayers ? 'full' : 'open',
    last_seen: new Date(nowMs).toISOString(),
  };
}

// Lobby view of registry rows: joinable rooms first (open, fullest first), stale and empty rows dropped.
export function lobbyRooms(rows, nowMs) {
  return (rows ?? [])
    .filter((r) => r && isRoomId(r.room_id) && r.status === 'open' && nowMs - Date.parse(r.last_seen) < ROOM_STALE_MS)
    .sort((a, b) => b.players - a.players || a.room_id.localeCompare(b.room_id))
    .map((r) => ({ id: r.room_id, mode: r.mode, players: r.players, max: r.max_players, phase: r.phase }));
}

// Quick play: the fullest joinable room with space, else a new room id in the requested mode.
export function quickPlayRoom(rows, mode, nowMs, random = Math.random) {
  const open = lobbyRooms(rows, nowMs).find((r) => r.mode === mode && r.players < r.max);
  return open ? open.id : makeRoomId(mode, newRoomCode(random));
}
