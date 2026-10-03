// MatchSession is the transport-agnostic session layer (docs/SPEC.md section 17). These tests
// drive it the way both server.js and the Base44 Match actor do: fake connections, injected clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MatchSession, MAX_PROTOCOL_STRIKES, BUCKET, PING_MIN_INTERVAL_MS, answerPing, exceedsMessageBytes } from '../../src/server/matchSession.js';
import { MAX_MESSAGE_BYTES } from '../../src/server/protocol.js';
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

test('an oversized parsed message is a strike even though the platform already parsed it', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'join', name: 'Ada' });
  const padding = 'x'.repeat(MAX_MESSAGE_BYTES);
  for (let i = 0; i < MAX_PROTOCOL_STRIKES; i++) session.message(c, { t: 'shoot', padding });
  assert.equal(c.closed, 'protocol_violations');
  assert.equal(session.playerCount, 0);
});

test('exceedsMessageBytes: scalars are not measured, 4 KB is the boundary, unserialisable counts as too large', () => {
  assert.equal(exceedsMessageBytes(null), false);
  assert.equal(exceedsMessageBytes('x'.repeat(10_000)), false, 'a string fails bad_shape instead');
  const exact = { t: 'shoot', p: 'x'.repeat(MAX_MESSAGE_BYTES - JSON.stringify({ t: 'shoot', p: '' }).length) };
  assert.equal(JSON.stringify(exact).length, MAX_MESSAGE_BYTES);
  assert.equal(exceedsMessageBytes(exact), false);
  exact.p += 'x';
  assert.equal(exceedsMessageBytes(exact), true);
  assert.equal(exceedsMessageBytes({ n: 1n }), true);
});

// ---------- ping / pong (SPEC 18.2) ----------

test('ping is answered with the echoed id and ts and the session clock, before and after join', () => {
  const { session, advance } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'ping', id: 0, ts: 777 });
  assert.deepEqual(c.sent.at(-1), { t: 'pong', id: 0, ts: 777, now: 1_000_000 });
  session.message(c, { t: 'join', name: 'p' });
  advance(1000);
  session.message(c, { t: 'ping', id: 1, ts: 1777 });
  assert.deepEqual(c.sent.at(-1), { t: 'pong', id: 1, ts: 1777, now: 1_001_000 });
  assert.equal(c.closed, null);
});

test('PING_MIN_INTERVAL_MS is 400 and a ping inside it on both clocks is dropped without a strike', () => {
  assert.equal(PING_MIN_INTERVAL_MS, 400);
  const { session, advance } = setup();
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'ping', id: 0, ts: 1000 });
  advance(100);
  for (let i = 1; i <= MAX_PROTOCOL_STRIKES + 2; i++) session.message(c, { t: 'ping', id: i, ts: 1000 + i });
  assert.equal(c.sent.filter((m) => m.t === 'pong').length, 1);
  assert.equal(c.closed, null, 'clamped pings are not protocol strikes');
  advance(300); // 400 ms of server time since the accepted ping
  session.message(c, { t: 'ping', id: 50, ts: 1400 });
  assert.equal(c.sent.filter((m) => m.t === 'pong').length, 2);
});

test('a ping inside the interval on the server clock but not on the client stamps is answered (frozen server clock)', () => {
  const { session } = setup(); // the clock never advances unless advance() is called
  const c = fakeConn('a');
  session.connect(c);
  session.message(c, { t: 'ping', id: 0, ts: 1000 });
  session.message(c, { t: 'ping', id: 1, ts: 2000 });
  session.message(c, { t: 'ping', id: 2, ts: 2100 }); // too soon on both: dropped
  session.message(c, { t: 'ping', id: 3, ts: 3000 });
  assert.deepEqual(c.sent.filter((m) => m.t === 'pong').map((m) => m.id), [0, 1, 3]);
});

test('pings still spend bucket tokens: a flood is closed with rate_limit like any other message', () => {
  const { session } = setup();
  const c = fakeConn('a');
  session.connect(c);
  for (let i = 0; i <= BUCKET.capacity; i++) session.message(c, { t: 'ping', id: i, ts: i });
  assert.equal(c.closed, 'rate_limit');
});

test('answerPing is the shared clamp: same decisions as the session, returns whether a pong went out', () => {
  const state = { lastPingAt: null, lastPingTs: null };
  const sent = [];
  const send = (o) => sent.push(o);
  assert.equal(answerPing(state, { t: 'ping', id: 0, ts: 1000 }, 5000, send), true);
  assert.equal(answerPing(state, { t: 'ping', id: 1, ts: 1100 }, 5100, send), false);
  assert.equal(answerPing(state, { t: 'ping', id: 2, ts: 2000 }, 5100, send), true, 'client stamps moved a second');
  assert.equal(answerPing(state, { t: 'ping', id: 3, ts: 2100 }, 5500, send), true, 'server clock moved 400 ms');
  assert.deepEqual(sent.map((m) => [m.id, m.ts, m.now]), [[0, 1000, 5000], [2, 2000, 5100], [3, 2100, 5500]]);
});
