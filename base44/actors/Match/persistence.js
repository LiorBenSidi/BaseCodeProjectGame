// Actor glue for SPEC 26 / 27: writes the Room registry row, MatchResult records and PlayerStats totals
// through the actor's service-role client. Fire-and-forget from the room's hooks: a failed write is
// logged and never touches the simulation. Every call lands on a persistence path (join, leave, match
// start, match end), never on a tick, and roster writes are coalesced to one in flight per room.
import { roomRow } from './shared/rooms.js';
import { matchResultRecord, statsDeltas, mergeStats } from './shared/persistence.js';

export class Persistence {
  #client;
  #log;
  #rosterBusy = false;
  #rosterNext = null;

  // `client` is the actor's `this.client`; writes use `client.asServiceRole.entities`.
  constructor(client, { logger = null } = {}) {
    this.#client = client;
    this.#log = logger;
  }

  get #entities() {
    return this.#client?.asServiceRole?.entities ?? null;
  }

  roster(info) {
    if (!this.#entities) return;
    this.#rosterNext = info;
    if (this.#rosterBusy) return; // the latest row wins when the current write finishes
    this.#drainRoster();
  }

  async #drainRoster() {
    this.#rosterBusy = true;
    try {
      while (this.#rosterNext) {
        const info = this.#rosterNext;
        this.#rosterNext = null;
        await this.#writeRoom(info);
      }
    } finally {
      this.#rosterBusy = false;
    }
  }

  async #writeRoom(info) {
    const row = roomRow(info);
    try {
      const Room = this.#entities.Room;
      const existing = await Room.filter({ room_id: row.room_id }, undefined, 1);
      if (existing?.length) await Room.update(existing[0].id, row);
      else await Room.create(row);
    } catch (err) {
      this.#log?.warn('room registry write failed', { error: err?.message });
    }
  }

  // SPEC 40.1: the row the room validates cosmetics against. Read only; null for a guest or a missing row.
  async statsFor(userId) {
    const ents = this.#entities;
    if (!ents || !userId) return null;
    const rows = await ents.PlayerStats.filter({ user_id: userId }, undefined, 1);
    return rows?.[0] ?? null;
  }

  matchEnd(info) {
    if (!this.#entities) return;
    this.#writeMatch(info).catch((err) => this.#log?.warn('match persistence failed', { error: err?.message }));
  }

  async #writeMatch({ roomId, mode, result, players, nowMs }) {
    const ents = this.#entities;
    try {
      await ents.MatchResult.create(matchResultRecord({ roomId, mode, result, players, nowMs }));
    } catch (err) {
      this.#log?.warn('match result write failed', { error: err?.message });
    }
    for (const d of statsDeltas({ result, players, nowMs })) {
      try {
        const rows = await ents.PlayerStats.filter({ user_id: d.user_id }, undefined, 1);
        const merged = mergeStats(rows?.[0], d);
        if (rows?.length) await ents.PlayerStats.update(rows[0].id, merged);
        else await ents.PlayerStats.create(merged);
      } catch (err) {
        this.#log?.warn('player stats write failed', { user: d.user_id, error: err?.message });
      }
    }
  }
}
