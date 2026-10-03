// Base44 Match actor: one live room per instance id, authoritative over every player in it.
//
// Platform contract (docs: "Creating Actors", verified against the runtime shim
// infra/base44-userapp-bundler/src/shim/actor.ts on 2026-10-03):
//   - handleStart runs on every wake; a hibernation wake keeps sockets attached without
//     re-running handleConnect, so MatchHost.wake() re-registers them and asks for a rejoin.
//   - The managed ticker (handleTick, a setTimeout loop inside the object) is declared but not relied
//     on: in production it was observed never to fire (2026-10-03, instrumented deploy), so the room
//     runs an event-driven clock instead (SPEC 17.3). Every hook ends in MatchHost.advance(), which
//     runs the simulation steps due by wall time (at most 3, then time is dropped, the TickLoop rule),
//     and a platform schedule ("clock", CLOCK_WAKE_MS) wakes the object through handleWake so an idle
//     room still advances (respawns, grenade fuses). Schedules are Durable Object alarms: they survive
//     hibernation and cost two storage writes per arm, which is why the heartbeat is coarse.
//   - Messages are JSON text in both directions; conn.send stringifies, handleMessage gets the
//     parsed object. Every incoming object still goes through validateClientMessage.
//   - Origin checks, connection tokens and the per-script connection rate limit are the
//     platform's; the per-connection message budget, protocol strikes and the 4 KB message
//     rule (re-measured on the parsed object, frames are capped at 32 MiB upstream) stay ours.
//   - The room object is created near its first joiner and never moves (idFromName, no
//     location hint): the lobby must encode the region in the room id.
//   - A hook that throws is swallowed by the runtime shim (and the rest of that hook, including the
//     ticker upkeep, is skipped), and actor console output is not reachable from outside. Every hook
//     therefore runs under a guard: the error is logged and the connection gets { t: 'error',
//     reason: 'internal' }. With the ACTOR_DIAG secret set to "1" the frame also carries the error's
//     name and message, and a client message { t: 'diag' } is answered with the clock internals and
//     per-hook counters (SPEC 17.3 diagnostic probe); leave the secret unset in production.
//
// Everything under ./server and ./shared is generated from src/ by base44/tools/sync-actor.mjs.
// Edit the originals in src/, then run the sync; tests/unit/actorBundle.test.js enforces it.

import { Actor } from "base44:runtime/actors";
import { MatchHost } from "./matchHost.js";
import { TICK_RATE } from "./shared/constants.js";

// Idle heartbeat for the event-driven clock. Active play advances the room on every input message
// (60 Hz per player), so this only bounds how long an idle room can stand still: half a second.
export const CLOCK_WAKE_MS = 500;
const CLOCK_KEY = "clock";
const DIAG_SECRET = "ACTOR_DIAG";

/** Diagnostics are opt-in through an app secret; read lazily because the runtime installs Base44 in the constructor. */
function diagEnabled(): boolean {
  try {
    const b44 = (globalThis as { Base44?: { secrets?: { get(name: string): string | undefined } } }).Base44;
    return b44?.secrets?.get(DIAG_SECRET) === "1";
  } catch {
    return false;
  }
}

interface ActorConn {
  id: string;
  identity?: { type: "authenticated"; userId: string } | { type: "anonymous"; anonymousId: string };
  send(data: unknown): void;
  reject(code: number, reason: string): void;
}

export default class Match extends Actor {
  tickIntervalMs = 1000 / TICK_RATE; // D-006: one simulation rate per room, 30 Hz today
  #host: MatchHost | null = null;
  #clockArmed = false; // in-memory only: after an eviction the persisted schedule fires anyway and re-arms
  #hooks: Record<string, number> = {}; // how often each hook ran in this object's lifetime, for the probe

  // Lazy on purpose: `instanceId` is `this.name`, which the runtime sets only when the first
  // request arrives. Reading it from a field initializer throws inside the constructor and the
  // platform answers every connection with 500 "user worker threw an exception" (seen 2026-10-03).
  get host(): MatchHost {
    this.#host ??= new MatchHost({ instanceId: this.instanceId, diag: diagEnabled() });
    return this.#host;
  }

  async handleStart() {
    this.guard("start", undefined, () => this.host.wake(this.getConnections() as ActorConn[]));
    await this.armClock();
  }

  shouldTick() {
    return this.host.shouldTick();
  }

  async handleConnect(conn: ActorConn) {
    this.guard("connect", conn, () => this.host.connect(conn));
    await this.armClock(conn);
  }

  async handleMessage(conn: ActorConn, msg: unknown) {
    this.guard("message", conn, () => {
      // Opt-in probe, answered before protocol validation; a no-op (false) unless ACTOR_DIAG is "1".
      if (this.host.probe(conn, msg, { hooks: { ...this.#hooks }, clockArmed: this.#clockArmed })) return;
      this.host.message(conn, msg);
    });
    await this.armClock(conn);
  }

  handleTick() {
    this.guard("tick", undefined, () => this.host.advance());
  }

  async handleClose(conn: ActorConn) {
    // The socket is gone; report to the log only.
    this.guard("close", undefined, () => this.host.close(conn));
    await this.armClock();
  }

  /** Platform schedule fired (Durable Object alarm): run the steps that are due, then re-arm while seated. */
  async handleWake(key: string) {
    if (key !== CLOCK_KEY) return;
    this.#clockArmed = false;
    this.guard("wake", undefined, () => this.host.advance());
    await this.armClock();
  }

  /** Run one hook body; a throw is reported through MatchHost.fail instead of vanishing in the runtime. */
  private guard(hook: string, conn: ActorConn | undefined, fn: () => unknown) {
    this.#hooks[hook] = (this.#hooks[hook] ?? 0) + 1;
    try {
      fn();
    } catch (err) {
      this.host.fail(hook, err, conn);
    }
  }

  /** Arm one heartbeat while the room has a seated player; re-arming the same key only moves its time. */
  private async armClock(conn?: ActorConn) {
    if (this.#clockArmed || !this.host.shouldTick()) return;
    this.#clockArmed = true;
    try {
      await this.schedule(CLOCK_KEY, Date.now() + CLOCK_WAKE_MS);
    } catch (err) {
      this.#clockArmed = false; // the next event tries again
      this.host.fail("schedule", err, conn);
    }
  }
}
