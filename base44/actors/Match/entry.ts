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
//     reason: 'internal' }. In a diagnostics room (id starting with "diag-", see isDiagRoom) the frame
//     also carries the error's name and message, and a client message { t: 'diag' } is answered with
//     the clock internals, per-hook counters and the ACTOR_BUILD marker (SPEC 17.3 diagnostic probe).
//     The gate is the room id because the platform uploads no app secret to an actor (verified in the
//     platform's actors design doc, 2026-10-03): an actor env holds only its config strings and keypair.
//
// Everything under ./server and ./shared is generated from src/ by base44/tools/sync-actor.mjs.
// Edit the originals in src/, then run the sync; tests/unit/actorBundle.test.js enforces it.

import { Actor } from "base44:runtime/actors";
import { MatchHost } from "./matchHost.js";
import { ClockSource } from "./clockSource.js";
import { Persistence } from "./persistence.js";
import { TICK_RATE, isDiagRoom } from "./shared/constants.js";

// Idle heartbeat for the event-driven clock. Active play advances the room on every input message
// (60 Hz per player), so this only bounds how long an idle room can stand still: half a second.
export const CLOCK_WAKE_MS = 500;
export const TIMER_EVIDENCE_MS = 1000;
export const TIMER_EVIDENCE_MAX = 600; // ten minutes of evidence per object lifetime, then the chain ends

const CLOCK_KEY = "clock";
// Bumped by hand with every actor change that ships; the diag probe reports it so a live room can be
// matched to the code it runs after a Publish (Durable Objects give no other way to read that back).
export const ACTOR_BUILD = "4.3"; // Pro: SPEC 30 to 39 (bots, range, ceremony, vote, radar, AFK, reaction station, weapons, melee, KOTH, CTF, ping wheel)

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
  #timerArmed = false;
  #timerTicks = 0;

  // Lazy on purpose: `instanceId` is `this.name`, which the runtime sets only when the first
  // request arrives. Reading it from a field initializer throws inside the constructor and the
  // platform answers every connection with 500 "user worker threw an exception" (seen 2026-10-03).
  get host(): MatchHost {
    this.#host ??= new MatchHost({
      instanceId: this.instanceId,
      diag: isDiagRoom(this.instanceId),
      clock: new ClockSource(),
      // SPEC 26 / 27: registry, results and stats through the actor's service role (no app secret needed)
      persistence: new Persistence(this.client),
    });
    return this.#host;
  }

  async handleStart() {
    this.guard("start", undefined, () => this.host.wake(this.getConnections() as ActorConn[]));
    this.armTimerEvidence();
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
      // Probe, answered before protocol validation; a no-op (false) outside a diag- room.
      if (this.host.probe(conn, msg, { build: ACTOR_BUILD, hooks: { ...this.#hooks }, clockArmed: this.#clockArmed })) return;
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

  /** SPEC 18.1 timerTick: a setTimeout chain that only counts. The probe shows whether timers fire here at all. */
  private armTimerEvidence() {
    if (this.#timerArmed) return;
    this.#timerArmed = true;
    const bump = () => {
      this.#timerTicks += 1;
      this.host.clock?.recordTimerTick(this.#timerTicks);
      if (this.#timerTicks < TIMER_EVIDENCE_MAX) setTimeout(bump, TIMER_EVIDENCE_MS);
    };
    setTimeout(bump, TIMER_EVIDENCE_MS);
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
