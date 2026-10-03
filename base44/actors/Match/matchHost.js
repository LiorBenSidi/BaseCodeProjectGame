// Glue between the Base44 Actor hooks (entry.ts) and MatchSession. Plain JavaScript with no
// platform imports, so tests/unit/matchHost.test.js can drive it with fake connections exactly
// the way the actor runtime does: connect, message, close, tick, and a wake with sockets attached.
//
// The actor's `conn` object is { id, identity?, send(data), reject(code, reason) }. MatchSession
// wants { id, send(obj), close(reason) }; wrapConn adapts one to the other.

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
    send: (obj) => conn.send(obj),
    close: (reason) => conn.reject(CLOSE_CODES[reason] ?? 4000, reason),
  };
}

export class MatchHost {
  #session;
  #log;
  #now;
  #tickMs;
  #maxCatchup;
  #anchorAt = null; // wall time the clock counts from; null while the room has no seated player
  #stepsSinceAnchor = 0;
  #diag;

  constructor({
    instanceId = 'match',
    logLevel = 'info',
    sink,
    now = () => Date.now(),
    tickMs = TICK_MS,
    maxCatchup = MAX_CATCHUP,
    diag = false,
  } = {}) {
    this.#now = now;
    this.#diag = diag === true;
    this.#tickMs = tickMs;
    this.#maxCatchup = maxCatchup;
    // The actor has no stdout; Cloudflare observability captures console output. logger.js lives
    // in src/server where console is banned, so the sink is injected from here instead.
    const logSink = sink ?? ((line) => console.log(line)); // policy-allow: NO_CONSOLE_SERVER because this file is actor glue outside src/
    this.#log = createLogger(`actor:${instanceId}`, { level: logLevel, sink: logSink });
    const room = new GameRoom({ now, logger: createLogger(`room:${instanceId}`, { level: logLevel, sink: logSink }) });
    this.#session = new MatchSession({ room, logger: this.#log, now });
  }

  get session() {
    return this.#session;
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
    this.#session.message(conn, msg);
    this.advance();
  }

  close(conn) {
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
   */
  advance() {
    if (!this.shouldTick()) {
      this.#anchorAt = null;
      this.#stepsSinceAnchor = 0;
      return 0;
    }
    const now = this.#now();
    if (this.#anchorAt === null) {
      this.#anchorAt = now - this.#tickMs; // the first step is due at once
      this.#stepsSinceAnchor = 0;
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
   * with diagnostics on (entry.ts reads the ACTOR_DIAG secret), so a production client never sees internals.
   * Never throws: a reporting failure must not mask the original error.
   */
  fail(hook, err, conn) {
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
}
