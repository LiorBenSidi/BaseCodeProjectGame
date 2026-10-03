// MatchHost adapts the actor runtime's connection objects to MatchSession and owns the wake
// behaviour. The fake conns here mirror the shim (id, send, reject(code, reason)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchHost, CLOSE_CODES, wrapConn } from '../../base44/actors/Match/matchHost.js';
import { MAX_PLAYERS } from '../../src/shared/constants.js';

function actorConn(id) {
  const c = { id, sent: [], rejected: null };
  c.send = (data) => c.sent.push(data);
  c.reject = (code, reason) => { c.rejected = { code, reason }; };
  return c;
}

const host = () => new MatchHost({ sink: () => {}, now: () => 1_000_000 });

test('close codes are in the application range Cloudflare accepts (1000 or 3000-4999)', () => {
  for (const code of Object.values(CLOSE_CODES)) {
    assert.ok(code === 1000 || (code >= 3000 && code <= 4999), `code ${code}`);
  }
});

test('wrapConn maps a session reason to reject(code, reason)', () => {
  const c = actorConn('a');
  const w = wrapConn(c);
  w.send({ t: 'x' });
  w.close('room_full');
  assert.deepEqual(c.sent, [{ t: 'x' }]);
  assert.deepEqual(c.rejected, { code: CLOSE_CODES.room_full, reason: 'room_full' });
  w.close('unknown_reason');
  assert.equal(c.rejected.code, 4000);
});

test('shouldTick is false for an empty room and true once a player joined', () => {
  const h = host();
  assert.equal(h.shouldTick(), false);
  const c = actorConn('a');
  h.connect(c);
  assert.equal(h.shouldTick(), false, 'a connection without a seat does not start the loop');
  h.message(c, { t: 'join', name: 'Ada' });
  assert.equal(h.shouldTick(), true);
  h.close(c);
  assert.equal(h.shouldTick(), false);
});

test('tick produces a snapshot for the joined player', () => {
  const h = host();
  const c = actorConn('a');
  h.connect(c);
  h.message(c, { t: 'join', name: 'Ada' });
  h.tick();
  assert.ok(c.sent.some((m) => m.t === 'snap'));
});

test('a cold wake with no sockets does nothing; a hibernation wake asks attached sockets to rejoin', () => {
  const h = host();
  assert.equal(h.wake([]), 0);
  const a = actorConn('a');
  const b = actorConn('b');
  assert.equal(h.wake([a, b]), 2);
  assert.deepEqual(a.sent, [{ t: 'rejoin' }]);
  assert.deepEqual(b.sent, [{ t: 'rejoin' }]);
  h.message(a, { t: 'join', name: 'A' });
  assert.equal(h.shouldTick(), true);
  assert.equal(h.session.connectionCount, 2);
});

test('wake does not duplicate a connection that is already registered', () => {
  const h = host();
  const a = actorConn('a');
  h.connect(a);
  h.message(a, { t: 'join', name: 'A' });
  assert.equal(h.wake([a]), 0, 'seated connection is not asked to rejoin');
  assert.equal(h.session.connectionCount, 1);
});

test('room full through the actor path rejects with 4013', () => {
  const h = host();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const c = actorConn(`p${i}`);
    h.connect(c);
    h.message(c, { t: 'join', name: `P${i}` });
  }
  const extra = actorConn('extra');
  h.connect(extra);
  h.message(extra, { t: 'join', name: 'Late' });
  assert.deepEqual(extra.rejected, { code: 4013, reason: 'room_full' });
});

test('hostile messages through the actor path strike and reject with 4008', () => {
  const h = host();
  const c = actorConn('a');
  h.connect(c);
  for (let i = 0; i < 5; i++) h.message(c, { t: 'hp', value: 999 });
  assert.deepEqual(c.rejected, { code: 4008, reason: 'protocol_violations' });
});
