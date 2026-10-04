// Client -> server message validation. This is the single door untrusted bytes go through.
// It never throws, and the returned message is rebuilt from whitelisted fields only, so
// unexpected properties (__proto__, isAdmin, hp, ...) can never reach game logic.

import { sanitizeName } from './security.js';

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
      return { ok: true, msg: { t: 'join', name: sanitizeName(data.name) } };
    case 'shoot':
      return { ok: true, msg: { t: 'shoot' } };
    case 'throw':
      return { ok: true, msg: { t: 'throw' } };
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
