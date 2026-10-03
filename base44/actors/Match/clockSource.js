// Time source for the Match actor (SPEC 18.1).
//
// Inside the deployed Durable Object, Date.now() was observed frozen across incoming WebSocket
// messages (2026-10-03: two diag frames 400 ms apart, 117 messages in between, identical `now`),
// the managed ticker never fires and the 500 ms schedule did not wake the object within 12 s.
// MatchHost.advance() therefore needs a clock that can move without the platform's help.
//
// ClockSource combines four candidates and returns a monotonic time:
//   wall        Date.now() as the runtime reports it (may be frozen).
//   ioWall      Date.now() read right after an awaited storage call; awaited I/O is where the
//               Workers clock is allowed to move. Fed by the actor through recordIoWall().
//   clientClock a virtual clock driven by the `ts` field of client input messages. Each
//               connection advances its own clock by the clamped difference between consecutive
//               timestamps (never backwards, at most maxClientStepMs per message), anchored at the
//               chosen time of its first stamped message so client clock skew never matters. The
//               room-wide candidate is the fastest connection. Once the server clock has been
//               seen moving (ioWall advanced at least once) the candidate may not run more than
//               aheadToleranceMs ahead of it, which bounds a speed hack to that lead.
//   timerTick   a counter the actor bumps from a setTimeout chain, evidence only: it never
//               drives the chosen time, the probe shows whether timers fire at all.
//
// now() returns max(previous, best candidate), so the time never goes backwards whichever
// candidate wins. probe() reports every candidate, how often each advanced, the chosen time and
// the source that last moved it.

export const CLOCK_AHEAD_TOLERANCE_MS = 250;
export const MAX_CLIENT_STEP_MS = 100;

export class ClockSource {
  #wallFn;
  #aheadToleranceMs;
  #maxClientStepMs;

  #wall;
  #ioWall = 0;
  #ioWallMoved = false; // true once ioWall advanced past its first reading: the server clock is alive
  #timerTick = 0;
  #conns = new Map(); // connId -> { lastTs, clock }

  #advances = { wall: 0, ioWall: 0, clientClock: 0, timerTick: 0 };
  #seen = { ioWall: 0, clientClock: 0, timerTick: 0 }; // last value counted as an advance

  #chosen;
  #source = 'wall';

  constructor({
    wall = () => Date.now(),
    aheadToleranceMs = CLOCK_AHEAD_TOLERANCE_MS,
    maxClientStepMs = MAX_CLIENT_STEP_MS,
  } = {}) {
    this.#wallFn = wall;
    this.#aheadToleranceMs = aheadToleranceMs;
    this.#maxClientStepMs = maxClientStepMs;
    this.#wall = wall();
    this.#chosen = this.#wall;
  }

  /** Date.now() sampled right after an awaited I/O call. */
  recordIoWall(value) {
    if (!isFiniteNumber(value) || value <= this.#ioWall) return;
    if (this.#ioWall > 0) this.#ioWallMoved = true;
    this.#ioWall = value;
  }

  /** A client input stamped with its own Date.now(). Non-numbers and backwards stamps are ignored. */
  recordClientTs(connId, ts) {
    if (!isFiniteNumber(ts) || ts < 0) return;
    const c = this.#conns.get(connId);
    if (!c) {
      // First stamp: anchor this connection's virtual clock at the current chosen time.
      this.#conns.set(connId, { lastTs: ts, clock: this.#chosen });
      return;
    }
    if (ts <= c.lastTs) return;
    c.clock += Math.min(ts - c.lastTs, this.#maxClientStepMs);
    c.lastTs = ts;
  }

  removeConnection(connId) {
    this.#conns.delete(connId);
  }

  /** Evidence counter bumped by the actor's setTimeout chain. */
  recordTimerTick(value) {
    if (!isFiniteNumber(value) || value <= this.#timerTick) return;
    this.#timerTick = value;
  }

  get clientClock() {
    let best = 0;
    for (const c of this.#conns.values()) if (c.clock > best) best = c.clock;
    return best;
  }

  now() {
    const w = this.#wallFn();
    if (isFiniteNumber(w) && w > this.#wall) {
      this.#wall = w;
      this.#advances.wall += 1;
    }
    if (this.#ioWall > this.#seen.ioWall) {
      this.#advances.ioWall += 1;
      this.#seen.ioWall = this.#ioWall;
    }
    if (this.#timerTick > this.#seen.timerTick) {
      this.#advances.timerTick += 1;
      this.#seen.timerTick = this.#timerTick;
    }

    const server = Math.max(this.#wall, this.#ioWall);
    let best = server;
    let source = this.#ioWall >= this.#wall && this.#ioWall > 0 ? 'ioWall' : 'wall';

    let client = this.clientClock;
    if (client > this.#seen.clientClock) {
      this.#advances.clientClock += 1;
      this.#seen.clientClock = client;
    }
    if (this.#ioWallMoved) client = Math.min(client, server + this.#aheadToleranceMs);
    if (client > best) {
      best = client;
      source = 'clientClock';
    }

    if (best > this.#chosen) {
      this.#chosen = best;
      this.#source = source;
    }
    return this.#chosen;
  }

  /** Snapshot for the diag frame. Reads the clock but, like now(), never steps the simulation. */
  probe() {
    const chosen = this.now();
    return {
      candidates: {
        wall: this.#wall,
        ioWall: this.#ioWall,
        clientClock: this.clientClock,
        timerTick: this.#timerTick,
      },
      advances: { ...this.#advances },
      connections: this.#conns.size,
      chosen,
      source: this.#source,
    };
  }
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
