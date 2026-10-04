// SPEC 26 / 27 actor glue: identity to userId, room mode from the instance id, service-role writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchHost, wrapConn } from '../../base44/actors/Match/matchHost.js';
import { Persistence } from '../../base44/actors/Match/persistence.js';

const tick = () => new Promise((r) => setImmediate(r));

function fakeClient() {
  const store = { Room: [], PlayerStats: [], MatchResult: [] };
  let nextId = 1;
  const table = (name) => ({
    filter: async (q) => store[name].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
    create: async (row) => { const r = { id: String(nextId++), ...row }; store[name].push(r); return r; },
    update: async (id, row) => { const i = store[name].findIndex((r) => r.id === id); store[name][i] = { id, ...row }; return store[name][i]; },
  });
  return { store, client: { asServiceRole: { entities: { Room: table('Room'), PlayerStats: table('PlayerStats'), MatchResult: table('MatchResult') } } } };
}

const conn = (id, identity) => ({ id, identity, sent: [], send(o) { this.sent.push(o); }, reject() {} });

test('wrapConn exposes the verified userId only for authenticated identities', () => {
  assert.equal(wrapConn(conn('c1', { type: 'authenticated', userId: 'u1' })).userId, 'u1');
  assert.equal(wrapConn(conn('c2', { type: 'anonymous', anonymousId: 'x' })).userId, null);
  assert.equal(wrapConn(conn('c3', undefined)).userId, null);
});

test('a tdm-* instance runs team deathmatch; the registry row and match records are written through the service role', async () => {
  const { store, client } = fakeClient();
  const clock = { t: 1_700_000_000_000 };
  const host = new MatchHost({ instanceId: 'tdm-abcdef', sink: () => {}, now: () => clock.t, persistence: new Persistence(client) });
  const a = conn('a', { type: 'authenticated', userId: 'user-a' });
  const b = conn('b', { type: 'anonymous', anonymousId: 'anon' });
  host.connect(a); host.message(a, { t: 'join', name: 'Alice' });
  host.connect(b); host.message(b, { t: 'join', name: 'Bob' });
  await tick(); await tick();
  const welcome = a.sent.find((m) => m.t === 'welcome');
  assert.equal(welcome.mode, 'tdm');
  assert.equal(store.Room.length, 1, 'one registry row per room, updated in place');
  assert.equal(store.Room[0].room_id, 'tdm-abcdef');
  assert.equal(store.Room[0].mode, 'tdm');
  assert.equal(store.Room[0].players, 2);
  assert.equal(store.Room[0].status, 'open');
  // run out the TDM clock
  clock.t += 480_001;
  host.advance();
  await tick(); await tick();
  assert.equal(store.MatchResult.length, 1);
  assert.equal(store.MatchResult[0].mode, 'tdm');
  assert.deepEqual(store.MatchResult[0].players.map((p) => p.user_id), ['user-a', null]);
  assert.equal(store.PlayerStats.length, 1, 'only the signed-in player gets a stats row');
  assert.equal(store.PlayerStats[0].user_id, 'user-a');
  assert.equal(store.PlayerStats[0].matches, 1);
  host.close(a);
  await tick();
  assert.equal(store.Room[0].players, 1);
});

test('a failing service-role write is swallowed and the room keeps running', async () => {
  const client = { asServiceRole: { entities: { Room: { filter: async () => { throw new Error('down'); } } } } };
  const host = new MatchHost({ instanceId: 'dm-abcdef', sink: () => {}, now: () => 1_700_000_000_000, persistence: new Persistence(client) });
  const a = conn('a', { type: 'authenticated', userId: 'u' });
  host.connect(a); host.message(a, { t: 'join', name: 'A' });
  await tick(); await tick();
  assert.ok(a.sent.some((m) => m.t === 'welcome'));
  assert.ok(a.sent.some((m) => m.t === 'snap'));
});
