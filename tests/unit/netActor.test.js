// Pure helpers of the Base44 client transport. The socket itself is the SDK's and is covered by
// the live smoke against a deployed room (docs/LIVE_TESTING.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomIdFromLocation, connectionId, ActorNetwork, STALE_MS } from '../../src/client/netActor.js';

test('roomIdFromLocation accepts a safe id and falls back otherwise', () => {
  assert.equal(roomIdFromLocation('?room=tdm-abcd'), 'tdm-abcd'); // SPEC 26 grammar
  assert.equal(roomIdFromLocation('?room=lobby_2'), 'arena-1'); // not <mode>-<code>
  assert.equal(roomIdFromLocation(''), 'arena-1');
  assert.equal(roomIdFromLocation('?room=a/b'), 'arena-1');
  assert.equal(roomIdFromLocation('?room=' + 'x'.repeat(65)), 'arena-1');
  assert.equal(roomIdFromLocation('?room=%3Cscript%3E'), 'arena-1');
  assert.equal(roomIdFromLocation('?room=', 'fallback'), 'fallback');
});

test('connectionId is created once per storage and reused', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const a = connectionId(storage);
  const b = connectionId(storage);
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{1,64}$/);
  store.set('bca.connectionId', 'bad/id');
  assert.notEqual(connectionId(storage), 'bad/id');
});

test('connectionId works without storage (incognito or blocked storage)', () => {
  assert.match(connectionId(null), /^[A-Za-z0-9_-]{1,64}$/);
});

test('ActorNetwork requires an appId and sends through the held connection', () => {
  assert.throws(() => new ActorNetwork({}, { roomId: 'r' }), TypeError);
  const sent = [];
  let subscriber = null;
  const fakeClient = {
    actors: {
      Match: (roomId) => ({
        connect: ({ id }) => {
          assert.equal(roomId, 'arena-1');
          assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
          return { send: (o) => sent.push(o), subscribe: (cb) => { subscriber = cb; return { unsubscribe() {} }; }, close() {} };
        },
      }),
    },
  };
  const got = [];
  const net = new ActorNetwork({ welcome: (m) => got.push(m) }, { appId: 'app', roomId: 'arena-1', client: fakeClient });
  net.connect('Ada');
  assert.deepEqual(sent, [{ t: 'join', name: 'Ada' }]);
  subscriber({ t: 'welcome', id: 1 });
  subscriber({ t: 'evil' });
  subscriber(null);
  assert.deepEqual(got, [{ t: 'welcome', id: 1 }]);
  net.close();
  net.send({ t: 'shoot' });
  assert.equal(sent.length, 1, 'nothing is sent after close');
  assert.equal(STALE_MS, 5000);
});
