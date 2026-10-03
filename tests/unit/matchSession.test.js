// MatchSession is the transport-agnostic session layer (docs/SPEC.md section 17). These tests
// drive it the way both server.js and the Base44 Match actor do: fake connections, injected clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MatchSession, MAX_PROTOCOL_STRIKES, BUCKET } from '../../src/server/matchSession.js';
import { MAX_PLAYERS } from '../../src/shared/constants.js';

function fakeConn(id) {
  const c = { id, sent: [], closed: null };
  c.send = (obj) => c.sent.push(obj);
  c.close = (reason) => { c.closed = reason; };
  return c;
}

function setup({ now } = {}) {
  let t = 1_000_000;
  const clock = now ?? (() => t);
  const room = new GameRoom({ now: clock, random: () => 0.5 });
  const session = new MatchSession({ room, now: clock });
  return { room, session, advance: (ms) => { t += ms; } };
}

const cmd = (seq) => ({ seq, fwd: 1, right: 0, jump: false, yaw: 0, pitch: 0 });

test('constructor requires a GameRoom', () => {
  assert.throws(() => new MatchSession({}), TypeError);
  assert.throws(() => new MatchSession({ room: {} }), TypeError);
});

test('connect requires send() and close(); duplicate ids are refused', () => {
  const { session } = setup();
  assert.throws(() => session.connect({ id: 'a' }), TypeError);
  const c = fakeConn('a');
  assert.equal(session.connect(c), true);
  assert.equal(session.connect(c), false);
  assert.equal(session.connectionCount, 1);
  assert.equal(session.playerCount, 0);
});

test('join creates a player and welcomes it; a second join is ignored', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  assert.equal(session.playerCount, 1);
  assert.equal(c.sent[0].t, 'welcome');
  const id = c.sent[0].id;
  session.message(c, { t: 'join', name: 'Other' });
  assert.equal(session.playerCount, 1);
  assert.equal(c.sent.filter((m) => m.t === 'welcome').length, 1);
  assert.equal(c.sent[0].id, id);
});

test('input, shoot and throw before join are dropped without effect', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'input', cmds: [cmd(0)] });
  session.message(c, { t: 'shoot' });
  session.message(c, { t: 'throw' });
  session.tick();
  assert.equal(session.playerCount, 0);
  assert.equal(c.sent.length, 0);
});

test('validated input reaches the room and is acknowledged in the snapshot', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  session.message(c, { t: 'input', cmds: [cmd(0), cmd(1)] });
  session.tick();
  const snap = c.sent.find((m) => m.t === 'snap');
  assert.ok(snap, 'snapshot sent');
  assert.equal(snap.ack, 1);
});

test('hostile payloads count as strikes; the connection closes at MAX_PROTOCOL_STRIKES', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  const bad = [null, 'string', 42, { t: 'input', cmds: 'nope' }, { t: 'admin' }, { __proto__: { t: 'join' } }];
  for (let i = 0; i < MAX_PROTOCOL_STRIKES - 1; i++) session.message(c, bad[i % bad.length]);
  assert.equal(c.closed, null);
  session.message(c, bad[0]);
  assert.equal(c.closed, 'protocol_violations');
  assert.equal(session.connectionCount, 0);
  assert.equal(session.playerCount, 0, 'the player leaves the room with the connection');
});

test('a flood over the token bucket closes the connection with rate_limit', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  for (let i = 0; i < BUCKET.capacity + 5 && c.closed === null; i++) session.message(c, { t: 'shoot' });
  assert.equal(c.closed, 'rate_limit');
  assert.equal(session.playerCount, 0);
});

test('a steady client under the refill rate is never closed', () => {
  const { session, advance } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  for (let i = 0; i < 600; i++) {
    advance(1000 / 60); // 60 messages per second, refill is 100 per second
    session.message(c, { t: 'input', cmds: [cmd(i)] });
  }
  assert.equal(c.closed, null);
});

test('room full: the extra connection gets an error and room_full close', () => {
  const { session } = setup();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const c = fakeConn(`p${i}`);
    session.connect(c);
    session.message(c, { t: 'join', name: `P${i}` });
  }
  assert.equal(session.playerCount, MAX_PLAYERS);
  const extra = fakeConn('extra');
  session.connect(extra);
  session.message(extra, { t: 'join', name: 'Late' });
  assert.deepEqual(extra.sent[0], { t: 'error', reason: 'room_full' });
  assert.equal(extra.closed, 'room_full');
  assert.equal(session.connectionCount, MAX_PLAYERS);
});

test('close removes the player; closing an unknown connection is a no-op', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  assert.equal(session.close(c), true);
  assert.equal(session.playerCount, 0);
  assert.equal(session.close(c), false);
  assert.equal(session.close({ id: 'ghost' }), false);
  assert.equal(session.close(undefined), false);
});

test('messages from a connection that never connected are ignored', () => {
  const { session } = setup();
  const ghost = fakeConn('ghost');
  session.message(ghost, { t: 'join', name: 'G' });
  session.message(undefined, { t: 'join', name: 'G' });
  assert.equal(session.playerCount, 0);
  assert.equal(ghost.sent.length, 0);
});

test('requestRejoin asks only seatless connections and returns the count', () => {
  const { session } = setup();
  const seated = fakeConn('seated');
  const fresh = fakeConn('fresh');
  session.connect(seated);
  session.message(seated, { t: 'join', name: 'S' });
  session.connect(fresh);
  assert.equal(session.requestRejoin(), 1);
  assert.deepEqual(fresh.sent, [{ t: 'rejoin' }]);
  assert.equal(seated.sent.some((m) => m.t === 'rejoin'), false);
});

test('two connections see each other in snapshots (the two-tab check, in process)', () => {
  const { session } = setup();
  const a = fakeConn('a');
  const b = fakeConn('b');
  session.connect(a); session.connect(b);
  session.message(a, { t: 'join', name: 'A' });
  session.message(b, { t: 'join', name: 'B' });
  session.message(a, { t: 'input', cmds: [cmd(0)] });
  session.tick();
  const snapB = b.sent.find((m) => m.t === 'snap');
  assert.equal(snapB.players.length, 2);
});
