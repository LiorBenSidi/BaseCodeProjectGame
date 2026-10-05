// SPEC 40.1 at room level: the server resolves cosmetics against the row hooks.statsFor returns, never the client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';

function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, botFill: 0, ...opts });
  return { room, clock };
}
function join(room, name, extra = {}) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name, ...extra });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}
const row = (id) => (id === 'u-ace' ? { user_id: id, kills: 500, matches: 40, wins: 12, best_kills: 25, xp: 20000 } : null);

test('guest: a locked wish resolves to defaults, the snapshot row carries no cs', () => {
  const { room } = newRoom();
  const a = join(room, 'A', { cosmetics: { badge: 'ace', accent: 'gold', tracer: 'crimson' } });
  room.tick();
  assert.deepEqual(a.p.cosmetics, { badge: 'none', accent: 'team', tracer: 'standard' });
  assert.equal('cs' in a.lastSnap().players.find((p) => p.id === a.p.id), false);
  assert.equal(a.of('cosmetics').length, 0, 'no hook, no row, no answer to send');
  room.removePlayer(a.p.id);
});

test('signed in: the async statsFor row unlocks the wish, the answer and the snapshot carry it; a later change is re-resolved', async () => {
  const calls = [];
  const hooks = { statsFor: async (uid) => { calls.push(uid); return row(uid); } };
  const { room } = newRoom({ hooks });
  const a = join(room, 'A', { userId: 'u-ace', cosmetics: { badge: 'ace', accent: 'gold', tracer: 'crimson' } });
  const b = join(room, 'B', { userId: 'u-new', cosmetics: { badge: 'ace' } });
  assert.deepEqual(a.p.cosmetics, { badge: 'none', accent: 'team', tracer: 'standard' }, 'free until the row lands');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['u-ace', 'u-new']);
  assert.deepEqual(a.p.cosmetics, { badge: 'ace', accent: 'gold', tracer: 'crimson' });
  assert.deepEqual(a.of('cosmetics')[0].cosmetics, a.p.cosmetics);
  assert.equal(a.of('cosmetics')[0].stats.kills, 500);
  assert.deepEqual(b.p.cosmetics, { badge: 'none', accent: 'team', tracer: 'standard' }, 'a signed-in player without a row is still a guest');
  assert.equal(b.of('cosmetics')[0].stats, null);
  room.tick();
  const mine = b.lastSnap().players.find((p) => p.id === a.p.id);
  assert.deepEqual(mine.cs, [4, 3, 1], 'everyone sees the packed form');
  room.handleCosmetics(a.p.id, { badge: 'legend', accent: 'mint', tracer: 'solar' });
  assert.deepEqual(a.p.cosmetics, { badge: 'legend', accent: 'mint', tracer: 'standard' }, 'solar needs 20 wins; the row has 12');
  assert.deepEqual(a.of('cosmetics').at(-1).cosmetics, a.p.cosmetics);
  room.removePlayer(a.p.id); room.removePlayer(b.p.id);
});

test('a throwing or rejecting statsFor leaves the guest state and never throws out of addPlayer', async () => {
  const { room } = newRoom({ hooks: { statsFor: () => Promise.reject(new Error('db down')) } });
  const a = join(room, 'A', { userId: 'u-ace', cosmetics: { badge: 'ace' } });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(a.p.cosmetics, { badge: 'none', accent: 'team', tracer: 'standard' });
  const { room: r2 } = newRoom({ hooks: { statsFor: () => { throw new Error('sync boom'); } } });
  assert.doesNotThrow(() => join(r2, 'B', { userId: 'u-ace' }));
  room.removePlayer(a.p.id);
});
