// Glue between the Base44 Actor hooks (entry.ts) and MatchSession. Plain JavaScript with no
// platform imports, so tests/unit/matchHost.test.js can drive it with fake connections exactly
// the way the actor runtime does: connect, message, close, tick, and a wake with sockets attached.
//
// The actor's `conn` object is { id, identity?, send(data), reject(code, reason) }. MatchSession
// wants { id, send(obj), close(reason) }; wrapConn adapts one to the other.

import { GameRoom } from './server/GameRoom.js';
import { createLogger } from './server/logger.js';
import { MatchSession } from './server/matchSession.js';

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

  constructor({ instanceId = 'match', logLevel = 'info', sink, now = () => Date.now() } = {}) {
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
    return asked;
  }

  connect(conn) {
    this.#session.connect(wrapConn(conn));
  }

  message(conn, msg) {
    this.#session.message(conn, msg);
  }

  close(conn) {
    this.#session.close(conn);
  }

  /** The platform also requires at least one live connection; this keeps empty rooms idle. */
  shouldTick() {
    return this.#session.playerCount > 0;
  }

  tick() {
    this.#session.tick();
  }
}
