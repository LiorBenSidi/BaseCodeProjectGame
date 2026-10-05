// Client -> server message validation. This is the single door untrusted bytes go through.
// It never throws, and the returned message is rebuilt from whitelisted fields only, so
// unexpected properties (__proto__, isAdmin, hp, ...) can never reach game logic.

import { sanitizeName } from './security.js';
import { isKit } from '../shared/abilities.js';

export const MAX_MESSAGE_BYTES = 4096;
export const MAX_CMDS_PER_MSG = 8;
const MAX_PITCH = 1.5533; // ~89 degrees

const fail = (reason) => ({ ok: false, reason });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseCmd(c) {
  if (!isPlainObject(c)) return null;
  if (!Number.isSafeInteger(c.seq) || c.seq < 0) return null;
  if (!isNum(c.fwd) || !isNum(c.right) || !isNum(c.yaw) || !isNum(c.pitch)) return null;
  return {
    seq: c.seq,
    fwd: clamp(c.fwd, -1, 1),
    right: clamp(c.right, -1, 1),
    jump: !!c.jump,
    sprint: !!c.sprint, // SPEC 23
    crouch: !!c.crouch, // SPEC 23
    dive: !!c.dive, // SPEC 32.2
    tac: !!c.tac, // SPEC 32.2 tactical sprint
    yaw: c.yaw,
    pitch: clamp(c.pitch, -MAX_PITCH, MAX_PITCH),
  };
}

// Object-level validation. Used directly by transports that already parsed the JSON
// (the Base44 Match actor receives parsed objects), and by parse() below for raw text.
function validateObject(data) {
  if (!isPlainObject(data) || typeof data.t !== 'string') return fail('bad_shape');

  switch (data.t) {
    case 'join':
      // SPEC 24.1: an optional kit id; anything else falls back to the default kit in the room.
      return { ok: true, msg: { t: 'join', name: sanitizeName(data.name), ...(isKit(data.kit) ? { kit: data.kit } : {}) } };
    case 'shoot':
      return { ok: true, msg: { t: 'shoot' } };
    case 'throw':
      return { ok: true, msg: { t: 'throw' } };
    // SPEC 20.3: weapon intents. The room's state machine decides whether they take effect.
    case 'reload':
      return { ok: true, msg: { t: 'reload' } };
    case 'switch':
      if (data.slot !== 'primary' && data.slot !== 'sidearm') return fail('bad_switch');
      return { ok: true, msg: { t: 'switch', slot: data.slot } };
    // SPEC 24.1 / 25.3: kit, ability and perk intents. The room's state machine decides whether they take effect.
    case 'melee': // SPEC 38.3: a swing with the kit's melee style
      return { ok: true, msg: { t: 'melee' } };
    case 'ability':
      if (data.slot !== 0 && data.slot !== 1) return fail('bad_ability');
      return { ok: true, msg: { t: 'ability', slot: data.slot } };
    case 'kit':
      if (!isKit(data.id)) return fail('bad_kit');
      return { ok: true, msg: { t: 'kit', id: data.id } };
    case 'perk':
      if (typeof data.id !== 'string' || data.id.length > 32) return fail('bad_perk');
      return { ok: true, msg: { t: 'perk', id: data.id } };
    case 'station':
      // SPEC 37.7: range reaction station; level null turns it off, otherwise easy / medium / hard
      if (data.level !== null && (typeof data.level !== 'string' || data.level.length > 16)) return fail('bad_station');
      return { ok: true, msg: { t: 'station', level: data.level } };
    case 'vote':
      // SPEC 34.4: next-map vote; the room checks the id against the open candidates
      if (typeof data.mapId !== 'string' || data.mapId.length === 0 || data.mapId.length > 32) return fail('bad_vote');
      return { ok: true, msg: { t: 'vote', mapId: data.mapId } };
    case 'mark':
      // SPEC 39.8: ping wheel mark; kind and point are checked here, the room rate-limits and relays to the team
      if (typeof data.kind !== 'string' || data.kind.length > 16 || !Array.isArray(data.at) || data.at.length !== 3 || !data.at.every(isNum)) return fail('bad_mark');
      return { ok: true, msg: { t: 'mark', kind: data.kind, at: data.at } };
    case 'chat':
      // SPEC 29.1: text only, length capped here so a 4 KB frame cannot carry a 4 KB line
      if (typeof data.text !== 'string' || data.text.length === 0 || data.text.length > 400) return fail('bad_chat');
      return { ok: true, msg: { t: 'chat', text: data.text } };
    case 'ping':
      // SPEC 18.2: clock sync probe; the session echoes id and ts back with its own clock.
      if (!Number.isSafeInteger(data.id) || data.id < 0 || !isNum(data.ts) || data.ts < 0) return fail('bad_ping');
      return { ok: true, msg: { t: 'ping', id: data.id, ts: data.ts } };
    case 'input': {
      if (!Array.isArray(data.cmds) || data.cmds.length < 1 || data.cmds.length > MAX_CMDS_PER_MSG) {
        return fail('bad_cmd');
      }
      const cmds = [];
      for (const c of data.cmds) {
        const parsed = parseCmd(c);
        if (!parsed) return fail('bad_cmd');
        cmds.push(parsed);
      }
      const msg = { t: 'input', cmds };
      // SPEC 18.1: optional client clock stamp (the client's Date.now()); absent or malformed stamps are dropped, never fatal.
      if (isNum(data.ts) && data.ts >= 0) msg.ts = data.ts;
      return { ok: true, msg };
    }
    default:
      return fail('bad_shape');
  }
}

function parse(raw) {
  let text;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) return fail('too_large');
    text = raw;
  } else if (raw instanceof Uint8Array) {
    if (raw.byteLength > MAX_MESSAGE_BYTES) return fail('too_large');
    text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  } else {
    return fail('bad_json');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('bad_json');
  }
  return validateObject(data);
}

// Already-parsed JSON (an object the transport decoded). Same whitelist, same reasons; the
// size guard is the transport's job (the actor platform caps WebSocket frames, ws uses maxPayload).
export function validateClientMessage(data) {
  try {
    return validateObject(data);
  } catch {
    return fail('bad_shape');
  }
}

export function parseClientMessage(raw) {
  try {
    return parse(raw);
  } catch {
    return fail('bad_json');
  }
}
