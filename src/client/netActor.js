// Base44 transport: the same handler contract as net.js, carried by a Match actor connection.
//
// Differences from the raw WebSocket path that the game has to live with:
//   - the SDK reconnects on its own (backoff, 1 s heartbeat, 3 s dead timer), so there is no
//     close event to show; a long silence is reported through `handlers.stale` instead;
//   - a reconnect that reuses the same connection id reclaims the server-side seat, which is why
//     the id is kept per tab in sessionStorage (never per browser: two tabs may not share one);
//   - after the room wakes from hibernation the server asks for `{ t: 'rejoin' }`; Game answers
//     with a fresh join (see game.js). Nothing here is trusted: unknown message types are dropped.
//
// The appId comes from VITE_BASE44_APP_ID, set by the Base44 build environment (sandbox env, or `base44 build`
// from BASE44_APP_ID); it is a public identifier.

import { createClient } from '@base44/sdk';

export const STALE_MS = 5000;
const CONN_KEY = 'bca.connectionId';

export { roomIdFromLocation } from '../shared/rooms.js'; // SPEC 26: moved to the shared room grammar

export function connectionId(storage) {
  let id = storage?.getItem(CONN_KEY);
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '');
    storage?.setItem(CONN_KEY, id);
  }
  return id;
}

export class ActorNetwork {
  #handlers;
  #conn = null;
  #client;
  #roomId;
  #lastMessage = 0;
  #watchdog = null;

  constructor(handlers, { appId, roomId, client = null } = {}) {
    if (typeof appId !== 'string' || appId.length === 0) throw new TypeError('ActorNetwork requires appId');
    this.#handlers = handlers;
    this.#roomId = roomId;
    this.#client = client ?? createClient({ appId, requiresAuth: false });
  }

  connect(name, kit, cosmetics = null) {
    const ref = this.#client.actors.Match(this.#roomId);
    this.#conn = ref.connect({ id: connectionId(globalThis.sessionStorage) });
    this.#conn.subscribe((msg) => {
      this.#lastMessage = performance.now();
      if (msg && typeof msg.t === 'string' && Object.hasOwn(this.#handlers, msg.t)) this.#handlers[msg.t](msg);
    });
    this.send({ t: 'join', name, ...(kit ? { kit } : {}), ...(cosmetics ? { cosmetics } : {}) }); // SPEC 40.1
    this.#lastMessage = performance.now();
    this.#watchdog = setInterval(() => {
      if (performance.now() - this.#lastMessage > STALE_MS) this.#handlers.stale?.();
    }, 1000);
  }

  send(obj) {
    this.#conn?.send(obj);
  }

  close() {
    if (this.#watchdog) clearInterval(this.#watchdog);
    this.#watchdog = null;
    this.#conn?.close();
    this.#conn = null;
  }
}
