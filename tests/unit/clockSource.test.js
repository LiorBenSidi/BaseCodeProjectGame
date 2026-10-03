// SPEC 18.1: ClockSource, the Match actor's time source when the runtime clock is frozen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSource, CLOCK_AHEAD_TOLERANCE_MS, MAX_CLIENT_STEP_MS, SERVER_ALIVE_WINDOW_MS } from '../../base44/actors/Match/clockSource.js';

const EPOCH = 1_791_051_197_625; // epoch-size like production, see Batch 1.2

function frozen(at = EPOCH) {
  return new ClockSource({ wall: () => at });
}

test('starts at the wall reading and holds while every candidate is frozen', () => {
  const cs = frozen();
  assert.equal(cs.now(), EPOCH);
  assert.equal(cs.now(), EPOCH);
  const p = cs.probe();
  assert.equal(p.chosen, EPOCH);
  assert.equal(p.source, 'wall');
  assert.deepEqual(p.advances, { wall: 0, ioWall: 0, clientClock: 0, timerTick: 0 });
});

test('a moving wall clock is followed and counted', () => {
  let t = EPOCH;
  const cs = new ClockSource({ wall: () => t });
  t += 40;
  assert.equal(cs.now(), EPOCH + 40);
  assert.equal(cs.probe().advances.wall, 1);
});

test('frozen wall + advancing ioWall: ioWall drives the clock', () => {
  const cs = frozen();
  cs.recordIoWall(EPOCH + 33);
  assert.equal(cs.now(), EPOCH + 33);
  cs.recordIoWall(EPOCH + 70);
  assert.equal(cs.now(), EPOCH + 70);
  const p = cs.probe();
  assert.equal(p.source, 'ioWall');
  assert.equal(p.advances.ioWall, 2);
  assert.equal(p.candidates.ioWall, EPOCH + 70);
});

test('ioWall never moves the clock backwards', () => {
  const cs = frozen();
  cs.recordIoWall(EPOCH + 100);
  assert.equal(cs.now(), EPOCH + 100);
  cs.recordIoWall(EPOCH + 50);
  assert.equal(cs.now(), EPOCH + 100);
});

test('frozen wall + frozen ioWall + 60 Hz client stamps: clientClock steps the clock by the client deltas', () => {
  const cs = frozen();
  let ts = 5_000; // the client clock has nothing to do with the server epoch
  cs.recordClientTs('c1', ts); // anchor, no movement yet
  assert.equal(cs.now(), EPOCH);
  for (let i = 0; i < 30; i++) {
    ts += 16;
    cs.recordClientTs('c1', ts);
  }
  assert.equal(cs.now(), EPOCH + 30 * 16);
  const p = cs.probe();
  assert.equal(p.source, 'clientClock');
  assert.equal(p.candidates.clientClock, EPOCH + 480);
  assert.ok(p.advances.clientClock >= 1);
});

test('a client stamp jumping far ahead advances by at most MAX_CLIENT_STEP_MS per message', () => {
  const cs = frozen();
  cs.recordClientTs('c1', 1_000);
  cs.recordClientTs('c1', 11_000); // 10 s jump
  assert.equal(cs.now(), EPOCH + MAX_CLIENT_STEP_MS);
});

test('backwards and non-numeric client stamps are ignored', () => {
  const cs = frozen();
  cs.recordClientTs('c1', 1_000);
  cs.recordClientTs('c1', 1_016);
  assert.equal(cs.now(), EPOCH + 16);
  cs.recordClientTs('c1', 900);
  cs.recordClientTs('c1', 1_016);
  cs.recordClientTs('c1', 'now');
  cs.recordClientTs('c1', NaN);
  cs.recordClientTs('c1', -5);
  assert.equal(cs.now(), EPOCH + 16);
});

test('the fastest connection wins and a closed connection stops contributing', () => {
  const cs = frozen();
  cs.recordClientTs('slow', 0);
  cs.recordClientTs('fast', 0);
  cs.recordClientTs('slow', 10);
  cs.recordClientTs('fast', 50);
  assert.equal(cs.now(), EPOCH + 50);
  cs.removeConnection('fast');
  assert.equal(cs.now(), EPOCH + 50); // monotonic: never drops back to the slow clock
  assert.equal(cs.probe().candidates.clientClock, EPOCH + 10);
  assert.equal(cs.probe().connections, 1);
});

test('while the server clock is alive, the client clock may lead it by at most the tolerance', () => {
  const cs = frozen();
  cs.recordIoWall(EPOCH); // first reading: not yet proof of movement
  cs.recordIoWall(EPOCH + 10); // moved: the server clock is alive
  assert.equal(cs.now(), EPOCH + 10);
  cs.recordClientTs('c1', 0);
  for (let i = 1; i <= 8; i++) cs.recordClientTs('c1', i * 100); // wants +800 ms, inside the alive window
  assert.equal(cs.now(), EPOCH + 10 + CLOCK_AHEAD_TOLERANCE_MS);
  cs.recordIoWall(EPOCH + 1_000); // server moved again
  for (let i = 9; i <= 16; i++) cs.recordClientTs('c1', i * 100); // wants +1600 ms in total
  assert.equal(cs.now(), EPOCH + 1_000 + CLOCK_AHEAD_TOLERANCE_MS);
});

test('server clock that moved at setup and froze again: after the alive window the client clock drives (live 2.0 finding)', () => {
  // Live diag-live-4 on build 2.0: wall/ioWall advanced 4 times while the connection was set up, then froze.
  // The lead clamp bound the client clock to a dead value and the room stopped after 15 steps.
  const cs = frozen();
  cs.recordIoWall(EPOCH);
  cs.recordIoWall(EPOCH + 10); // moved once: alive for now
  assert.equal(cs.now(), EPOCH + 10);
  cs.recordClientTs('c1', 0);
  // Inside the alive window the clamp holds.
  for (let i = 1; i <= 5; i++) cs.recordClientTs('c1', i * 100); // +500 ms of client time
  assert.equal(cs.now(), EPOCH + 10 + CLOCK_AHEAD_TOLERANCE_MS);
  // Past the window with no server movement, the server clock counts as frozen and the client clock leads.
  const steps = SERVER_ALIVE_WINDOW_MS / 100 + 5;
  for (let i = 6; i <= 5 + steps; i++) cs.recordClientTs('c1', i * 100);
  assert.equal(cs.now(), EPOCH + 10 + (5 + steps) * 100);
  assert.equal(cs.probe().source, 'clientClock');
});

test('a server clock that keeps moving keeps the lead clamp active', () => {
  let t = EPOCH;
  const cs = new ClockSource({ wall: () => t });
  cs.recordClientTs('c1', 0);
  for (let i = 1; i <= 100; i++) {
    t += 10; // server moves 10 ms per message
    cs.recordClientTs('c1', i * 100); // client claims 100 ms per message (speed hack)
    assert.ok(cs.now() <= t + CLOCK_AHEAD_TOLERANCE_MS, `message ${i}: ${cs.now()} > ${t + CLOCK_AHEAD_TOLERANCE_MS}`);
  }
});

test('the server clock resuming re-arms the clamp without moving the chosen time backwards', () => {
  const cs = frozen();
  cs.recordIoWall(EPOCH);
  cs.recordIoWall(EPOCH + 10);
  cs.recordClientTs('c1', 0);
  const steps = SERVER_ALIVE_WINDOW_MS / 100 + 10;
  for (let i = 1; i <= steps; i++) cs.recordClientTs('c1', i * 100);
  const led = cs.now();
  assert.ok(led > EPOCH + 10 + CLOCK_AHEAD_TOLERANCE_MS);
  cs.recordIoWall(EPOCH + 20); // server alive again, far behind the client clock
  assert.equal(cs.now(), led); // monotonic: no drop
  cs.recordClientTs('c1', (steps + 1) * 100);
  assert.equal(cs.now(), led); // clamped again: client may not lead a live server clock further
});

test('while ioWall never moved, the client clock is not clamped (it is the only time there is)', () => {
  const cs = frozen();
  cs.recordIoWall(EPOCH); // one reading equal to the wall, no movement
  cs.recordClientTs('c1', 0);
  for (let i = 1; i <= 20; i++) cs.recordClientTs('c1', i * 100);
  assert.equal(cs.now(), EPOCH + 2_000);
});

test('timerTick is evidence only: counted, never chosen', () => {
  const cs = frozen();
  cs.recordTimerTick(1);
  cs.recordTimerTick(2);
  assert.equal(cs.now(), EPOCH);
  const p = cs.probe();
  assert.equal(p.candidates.timerTick, 2);
  assert.equal(p.advances.timerTick, 1); // both ticks landed before one now(): one observed advance
  assert.equal(p.source, 'wall');
});

test('probe reports every candidate and the chosen value', () => {
  const cs = frozen();
  const p = cs.probe();
  assert.deepEqual(Object.keys(p).sort(), ['advances', 'candidates', 'chosen', 'connections', 'serverAlive', 'source']);
  assert.equal(p.serverAlive, false);
  assert.deepEqual(Object.keys(p.candidates).sort(), ['clientClock', 'ioWall', 'timerTick', 'wall']);
});
