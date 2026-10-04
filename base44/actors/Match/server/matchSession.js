// Transport-agnostic session layer between a connection source and one GameRoom.
//
// server.js (Node + ws) and the Base44 Match actor (base44/actors/Match) both have to do the
// same work for every connection: budget messages, count protocol strikes, turn "join" into a
// player, route input/shoot/throw, and clean up on close. This class owns that work once, so the
// two transports cannot drift apart. It has no sockets, timers or clocks of its own: `now` is
// injected (like GameRoom), and a connection is any object with `send(obj)` and `close(reason)`.
//
//   const session = new MatchSession({ room, logger });
//   session.connect(conn);           // conn: { id, send(obj), close(reason) }
//   session.message(conn, data);     // data: already-parsed JSON (validated here)
//   session.close(conn);             // transport reports the socket went away
//   session.tick();                  // advance the room (caller owns the schedule)
//
// `close(reason)` reasons are stable strings the transport maps to its own close codes:
//   'rate_limit' | 'protocol_violations' | 'room_full' | 'text_only'
// (ws uses 1008 / 1013, the actor uses 4008 / 4013: Cloudflare rejects some 1xxx codes).

import { MAX_MESSAGE_BYTES, validateClientMessage } from './protocol.js';
import { TokenBucket } from './rateLimit.js';

export const MAX_PROTOCOL_STRIKES = 5;
export const BUCKET = Object.freeze({ capacity: 120, refillPerSec: 100 });
// SPEC 18.2: a ping inside this interval of the previous accepted ping, on both the server clock and the
// client's own stamps, is dropped silently. Both clocks, because a frozen server clock (SPEC 18.1) would
// otherwise block every ping after the first.
export const PING_MIN_INTERVAL_MS = 400;

/**
 * SPEC 18.2: answer a ping with the given clock reading, unless it is inside the clamp on both clocks.
 * `state` is the per-connection { lastPingAt, lastPingTs } record (mutated); shared by MatchSession and the
 * ws path in server.js so both transports apply the same rule. Returns true when a pong was sent.
 */
export function answerPing(state, msg, now, send) {
  if (state.lastPingAt !== null
    && now - state.lastPingAt < PING_MIN_INTERVAL_MS
    && msg.ts - state.lastPingTs < PING_MIN_INTERVAL_MS) return false;
  state.lastPingAt = now;
  state.lastPingTs = msg.ts;
  send({ t: 'pong', id: msg.id, ts: msg.ts, now });
  return true;
}

/** True when the JSON text of `data` would exceed MAX_MESSAGE_BYTES (or cannot be serialised). */
export function exceedsMessageBytes(data) {
  if (data === null || typeof data !== 'object') return false; // scalars fail the shape check anyway
  try {
    return JSON.stringify(data).length > MAX_MESSAGE_BYTES;
  } catch {
    return true;
  }
}

export class MatchSession {
  #room;
  #log;
  #now;
  #conns = new Map(); // conn.id -> { conn, bucket, strikes, player }

  constructor({ room, logger = null, now = () => Date.now() } = {}) {
    if (!room || typeof room.tick !== 'function') throw new TypeError('MatchSession requires a GameRoom');
    this.#room = room;
    this.#log = logger;
    this.#now = now;
  }

  get room() {
    return this.#room;
  }

  get playerCount() {
    return this.#room.playerCount;
  }

  get connectionCount() {
    return this.#conns.size;
  }

  /** True when the given connection id is known to this session. */
  has(id) {
    return this.#conns.has(id);
  }

  connect(conn) {
    if (!conn || typeof conn.send !== 'function' || typeof conn.close !== 'function') {
      throw new TypeError('connect requires a connection with send(obj) and close(reason)');
    }
    if (this.#conns.has(conn.id)) return false; // a transport bug, not a player action
    this.#conns.set(conn.id, {
      conn,
      bucket: new TokenBucket({ ...BUCKET, now: this.#now }),
      strikes: 0,
      player: null,
      ping: { lastPingAt: null, lastPingTs: null }, // SPEC 18.2 clamp state, see answerPing
    });
    return true;
  }

  message(conn, data) {
    const s = this.#conns.get(conn?.id);
    if (!s) return;
    if (!s.bucket.take()) {
      this.#log?.warn('connection closed: rate limit', { conn: conn.id });
      this.#drop(s, 'rate_limit');
      return;
    }
    // The actor platform hands us parsed JSON and caps a frame at 32 MiB (Cloudflare), not at our
    // 4 KB. Re-measure here so the 4 KB rule of section 5 holds on both transports; on the ws path
    // parseClientMessage already refused anything larger, so this is a cheap no-op there.
    const parsed = exceedsMessageBytes(data) ? { ok: false, reason: 'too_large' } : validateClientMessage(data);
    if (!parsed.ok) {
      this.#log?.debug('bad client message', { reason: parsed.reason });
      s.strikes += 1;
      if (s.strikes >= MAX_PROTOCOL_STRIKES) this.#drop(s, 'protocol_violations');
      return;
    }
    const { msg } = parsed;
    if (msg.t === 'ping') {
      answerPing(s.ping, msg, this.#now(), (obj) => s.conn.send(obj));
      return;
    }
    if (msg.t === 'join') {
      if (s.player) return;
      const player = this.#room.addPlayer({ name: msg.name, kit: msg.kit, userId: s.conn.userId ?? null, send: (obj) => s.conn.send(obj) }); // SPEC 27: userId comes from the transport, never the payload
      if (!player) {
        s.conn.send({ t: 'error', reason: 'room_full' });
        this.#drop(s, 'room_full');
        return;
      }
      s.player = player;
    } else if (s.player && msg.t === 'input') {
      this.#room.handleInput(s.player.id, msg.cmds);
    } else if (s.player && msg.t === 'shoot') {
      this.#room.handleShoot(s.player.id);
    } else if (s.player && msg.t === 'throw') {
      this.#room.handleThrow(s.player.id);
    } else if (s.player && msg.t === 'reload') {
      this.#room.handleReload(s.player.id);
    } else if (s.player && msg.t === 'ability') {
      this.#room.handleAbility(s.player.id, msg.slot);
    } else if (s.player && msg.t === 'kit') {
      this.#room.handleKit(s.player.id, msg.id);
    } else if (s.player && msg.t === 'perk') {
      this.#room.handlePerk(s.player.id, msg.id);
    } else if (s.player && msg.t === 'switch') {
      this.#room.handleSwitch(s.player.id, msg.slot);
    } else if (s.player && msg.t === 'chat') {
      this.#room.handleChat(s.player.id, msg.text);
    }
  }

  close(conn) {
    const s = this.#conns.get(conn?.id);
    if (!s) return false;
    this.#conns.delete(conn.id);
    if (s.player) this.#room.removePlayer(s.player.id);
    return true;
  }

  /** Ask every connection without a player to (re)join: used after the actor wakes. */
  requestRejoin() {
    let n = 0;
    for (const s of this.#conns.values()) {
      if (s.player) continue;
      s.conn.send({ t: 'rejoin' });
      n += 1;
    }
    return n;
  }

  tick() {
    this.#room.tick();
  }

  #drop(s, reason) {
    // Remove first so a close event echoed back by the transport is a no-op.
    this.#conns.delete(s.conn.id);
    if (s.player) this.#room.removePlayer(s.player.id);
    s.conn.close(reason);
  }
}
