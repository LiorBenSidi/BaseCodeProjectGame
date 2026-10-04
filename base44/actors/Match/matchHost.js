// Glue between the Base44 Actor hooks (entry.ts) and MatchSession. Plain JavaScript with no
// platform imports, so tests/unit/matchHost.test.js can drive it with fake connections exactly
// the way the actor runtime does: connect, message, close, tick, and a wake with sockets attached.
//
// The actor's `conn` object is { id, identity?, send(data), reject(code, reason) }. MatchSession
// wants { id, send(obj), close(reason) }; wrapConn adapts one to the other.

import { modeForRoomId } from './shared/rooms.js';
import { GameRoom } from './server/GameRoom.js';
import { createLogger } from './server/logger.js';
import { MatchSession } from './server/matchSession.js';
import { TICK_RATE } from './shared/constants.js';

/** One simulation step per TICK_MS of wall time (D-006). */
export const TICK_MS = 1000 / TICK_RATE;
/** Steps run back to back after a stall before the rest of the time is dropped: the platform TickLoop bound. */
export const MAX_CATCHUP = 3;

// Cloudflare only lets an application close a socket with 1000 or 3000-4999, so the ws codes
// used by src/server/server.js (1008 policy violation, 1013 try again later) become 4008 / 4013.
export const CLOSE_CODES = Object.freeze({
  rate_limit: 4008,
  protocol_violations: 4008,
  room_full: 4013,
  text_only: 4003,
});

export function wrapConn(conn) {
  return {
    id: conn.id,
    // SPEC 27: the platform-verified principal; anonymous visitors get null and no persistent stats
    userId: conn.identity?.type === 'authenticated' && typeof conn.identity.userId === 'string' ? conn.identity.userId : null,
    send: (obj) => conn.send(obj),
    close: (reason) => conn.reject(CLOSE_CODES[reason] ?? 4000, reason),
  };
}

export class MatchHost {
  #session;
  #log;
  #now;
  #clock; // ClockSource (SPEC 18.1) or null when the caller injects a plain now()
  #tickMs;
  #maxCatchup;
  #anchorAt = null; // wall time the clock counts from; null while the room has no seated player
  #stepsSinceAnchor = 0;
  #diag;
  #lastFail = null; // { hook, name, message, at } of the last error reported through fail(), for the probe

  constructor({
    instanceId = 'match',
    logLevel = 'info',
    sink,
    clock = null,
    now = clock ? () => clock.now() : () => Date.now(),
    tickMs = TICK_MS,
    maxCatchup = MAX_CATCHUP,
    diag = false,
    persistence = null, // SPEC 26 / 27: { roster(info), matchEnd(info) } backed by the actor's service role
  } = {}) {
    this.#now = now;
    this.#clock = clock;
    this.#diag = diag === true;
    this.#tickMs = tickMs;
    this.#maxCatchup = maxCatchup;
    // The actor has no stdout; Cloudflare observability captures console output. logger.js lives
    // in src/server where console is banned, so the sink is injected from here instead.
    const logSink = sink ?? ((line) => console.log(line)); // policy-allow: NO_CONSOLE_SERVER because this file is actor glue outside src/
    this.#log = createLogger(`actor:${instanceId}`, { level: logLevel, sink: logSink });
    // SPEC 26: the mode is part of the room id, so every joiner of `tdm-xxxx` plays the same mode.
    const hooks = persistence
      ? {
        roster: (info) => persistence.roster({ ...info, roomId: instanceId, mode: modeForRoomId(instanceId) }),
        matchEnd: (info) => persistence.matchEnd({ ...info, roomId: instanceId }),
      }
      : null;
    const room = new GameRoom({ now, mode: modeForRoomId(instanceId), hooks, logger: createLogger(`room:${instanceId}`, { level: logLevel, sink: logSink }) });
    this.#session = new MatchSession({ room, logger: this.#log, now });
  }

  get session() {
    return this.#session;
  }

  get clock() {
    return this.#clock;
  }

  /** Any wake (deploy, idle-out, hibernation). Sockets still attached must re-announce themselves. */
  wake(conns) {
    let attached = 0;
    for (const conn of conns) {
      if (this.#session.connect(wrapConn(conn))) attached += 1;
    }
    const asked = this.#session.requestRejoin();
    if (attached > 0) this.#log.info('actor woke with sockets attached', { attached, asked });
    this.advance();
    return asked;
  }

  connect(conn) {
    this.#session.connect(wrapConn(conn));
    this.advance();
  }

  message(conn, msg) {
    // SPEC 18.1 / 18.2: the client's clock stamp (on inputs and pings) feeds the ClockSource before the
    // session (and its token bucket, which refills from the same clock) looks at the time.
    if (this.#clock && msg !== null && typeof msg === 'object' && (msg.t === 'input' || msg.t === 'ping')) {
      this.#clock.recordClientTs(conn.id, msg.ts);
    }
    this.#session.message(conn, msg);
    this.advance();
  }

  close(conn) {
    this.#clock?.removeConnection(conn.id);
    this.#session.close(conn);
    this.advance();
  }

  /** The platform also requires at least one live connection; this keeps empty rooms idle. */
  shouldTick() {
    return this.#session.playerCount > 0;
  }

  /**
   * Event-driven clock (SPEC 17.3). The deployed actor has no reliable timer, so every event (connect,
   * message, close, wake, platform tick, clock wake) samples wall time and runs the steps that are due:
   * at most maxCatchup back to back, then the remaining time is dropped and the clock re-anchors to now,
   * exactly the platform TickLoop's rule. A room that just got its first player steps immediately, so the
   * first snapshot leaves with the welcome. Returns the number of steps run.
   *
   * Precision rule: the anchor is always a raw clock reading and the only division is of (now - anchor), a
   * small difference of two readings. Never subtract tickMs from an epoch-size reading: at 1.7e12 ms a double
   * keeps about 0.0002 ms, so (now - (now - 33.333)) / 33.333 rounds below 1 and the first step is lost. That
   * is what happened in production on 2026-10-03 while every test at now = 1_000_000 passed.
   */
  advance() {
    if (!this.shouldTick()) {
      this.#anchorAt = null;
      this.#stepsSinceAnchor = 0;
      return 0;
    }
    const now = this.#now();
    if (this.#anchorAt === null) {
      this.#anchorAt = now;
      this.#stepsSinceAnchor = -1; // one step behind the anchor: the first step is due at once
    }
    // Integer step accounting from a fixed anchor, so 1000 / 30 never drifts through float sums.
    const due = Math.floor((now - this.#anchorAt) / this.#tickMs + 1e-6) - this.#stepsSinceAnchor;
    const steps = Math.min(Math.max(due, 0), this.#maxCatchup);
    for (let i = 0; i < steps; i++) this.#session.tick();
    this.#stepsSinceAnchor += steps;
    if (due > steps) {
      this.#log.debug('clock dropped time after a stall', { droppedSteps: due - steps });
      this.#anchorAt = now;
      this.#stepsSinceAnchor = 0;
    }
    return steps;
  }

  /** The managed ticker (handleTick) shares the wall-time gate, so it can never double step. */
  tick() {
    return this.advance();
  }

  /**
   * A hook threw. The actor runtime swallows hook errors silently (and skips the rest of the hook), so the
   * error is logged here and the connection it happened on is told that the server failed on its behalf:
   * { t: 'error', reason: 'internal', hook }. The error's name and message are added only when the host runs
   * with diagnostics on (entry.ts enables them only for diag- rooms, isDiagRoom), so a play room never shows internals.
   * Never throws: a reporting failure must not mask the original error.
   */
  fail(hook, err, conn) {
    this.#lastFail = {
      hook,
      name: String(err?.name ?? 'Error'),
      message: String(err?.message ?? err),
      at: this.#now(),
    };
    const fields = { hook, err };
    if (this.#diag && err?.stack) fields.stack = String(err.stack);
    try {
      this.#log.error('hook threw', fields);
    } catch {
      // the logger is the thing being reported on; nothing left to do
    }
    if (!conn || typeof conn.send !== 'function') return;
    const frame = { t: 'error', reason: 'internal', hook };
    if (this.#diag) {
      frame.name = String(err?.name ?? 'Error');
      frame.message = String(err?.message ?? err);
    }
    try {
      conn.send(frame);
    } catch {
      // socket already gone
    }
  }

  /**
   * Diagnostic probe (SPEC 17.3). With diagnostics on, a client message { t: 'diag' } is answered with the clock
   * internals and the last reported hook error, plus whatever the actor adds (hook counters, heartbeat state).
   * It never advances the clock, so two probes some milliseconds apart show whether the object's wall clock
   * moves between messages. Returns true when the message was consumed; false means "not for me", including
   * every message while diagnostics are off (any room not named diag-*), where { t: 'diag' } is an unknown type like any other.
   */
  probe(conn, msg, extras = {}) {
    if (!this.#diag || msg === null || typeof msg !== 'object' || msg.t !== 'diag') return false;
    const frame = {
      t: 'diag',
      now: this.#now(),
      anchorAt: this.#anchorAt,
      stepsSinceAnchor: this.#stepsSinceAnchor,
      tickMs: this.#tickMs,
      maxCatchup: this.#maxCatchup,
      playerCount: this.#session.playerCount,
      lastFail: this.#lastFail,
      clock: this.#clock ? this.#clock.probe() : null,
      ...extras,
    };
    try {
      conn.send(frame);
    } catch {
      // socket already gone
    }
    return true;
  }
}
