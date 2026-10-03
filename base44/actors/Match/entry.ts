// Base44 Match actor: one live room per instance id, authoritative over every player in it.
//
// Platform contract (docs: "Creating Actors", verified against the runtime shim
// infra/base44-userapp-bundler/src/shim/actor.ts on 2026-10-03):
//   - handleStart runs on every wake; a hibernation wake keeps sockets attached without
//     re-running handleConnect, so MatchHost.wake() re-registers them and asks for a rejoin.
//   - The managed ticker calls handleTick every tickIntervalMs while shouldTick() is true and
//     at least one connection is open. No minimum interval is enforced; late ticks catch up
//     at most 3 steps, then time is dropped (TickLoop.maxCatchup).
//   - Messages are JSON text in both directions; conn.send stringifies, handleMessage gets the
//     parsed object. Every incoming object still goes through validateClientMessage.
//   - Origin checks, connection tokens and the per-script connection rate limit are the
//     platform's; the per-connection message budget, protocol strikes and the 4 KB message
//     rule (re-measured on the parsed object, frames are capped at 32 MiB upstream) stay ours.
//   - The room object is created near its first joiner and never moves (idFromName, no
//     location hint): the lobby must encode the region in the room id.
//
// Everything under ./server and ./shared is generated from src/ by base44/tools/sync-actor.mjs.
// Edit the originals in src/, then run the sync; tests/unit/actorBundle.test.js enforces it.

import { Actor } from "base44:runtime/actors";
import { MatchHost } from "./matchHost.js";
import { TICK_RATE } from "./shared/constants.js";

interface ActorConn {
  id: string;
  identity?: { type: "authenticated"; userId: string } | { type: "anonymous"; anonymousId: string };
  send(data: unknown): void;
  reject(code: number, reason: string): void;
}

export default class Match extends Actor {
  tickIntervalMs = 1000 / TICK_RATE; // D-006: one simulation rate per room, 30 Hz today
  host = new MatchHost({ instanceId: this.instanceId });

  handleStart() {
    this.host.wake(this.getConnections() as ActorConn[]);
  }

  shouldTick() {
    return this.host.shouldTick();
  }

  handleConnect(conn: ActorConn) {
    this.host.connect(conn);
  }

  handleMessage(conn: ActorConn, msg: unknown) {
    this.host.message(conn, msg);
  }

  handleTick() {
    this.host.tick();
  }

  handleClose(conn: ActorConn) {
    this.host.close(conn);
  }
}
