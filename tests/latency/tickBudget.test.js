// Latency budget (D-034, after gsp-sim-bench tests/Latency_Tests/test_latency.py): the room ticks at 60 Hz, so one
// tick with a full room must stay far below 16.7 ms on CI hardware. Measured with 12 humans sending 4 commands each
// plus 4 medium bots, 600 ticks (10 simulated seconds), p99 per tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../../src/server/GameRoom.js';

const BUDGET_P99_MS = 6; // a third of the frame, leaves room for I/O and the slower CI runners

test(`a full room ticks under ${BUDGET_P99_MS} ms p99 with 12 humans and 4 bots`, () => {
  let now = 1_000_000;
  const room = new GameRoom({ now: () => now, random: () => 0.42, maxPlayers: 32, botFill: 16, botDifficulty: 'medium', botSeed: 1 }); // fill to 16 seats: 12 humans + 4 bots
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(room.addPlayer({ send: () => {}, name: `P${i}` }).id);
  const samples = [];
  let seq = 0;
  for (let t = 0; t < 600; t++) {
    now += 1000 / 60;
    for (const id of ids) {
      room.handleInput(id, [{ seq: ++seq, fwd: 1, right: (t % 7) - 3 > 0 ? 1 : -1, yaw: (t + seq) * 0.01, pitch: 0, jump: t % 60 === 0, crouch: false, sprint: true, ts: now }]);
      if (t % 5 === 0) room.handleShoot(id);
    }
    const s = performance.now();
    room.tick();
    samples.push(performance.now() - s);
  }
  samples.sort((a, b) => a - b);
  const p = (q) => samples[Math.floor(q * (samples.length - 1))];
  const report = { p50: p(0.5).toFixed(3), p99: p(0.99).toFixed(3), max: p(1).toFixed(3), humans: room.humanCount, bots: room.botCount };
  console.log(`tick budget: ${JSON.stringify(report)}`);
  assert.equal(room.humanCount, 12);
  assert.equal(room.botCount, 4, 'bots filled the remaining seats');
  assert.ok(p(0.99) < BUDGET_P99_MS, `p99 ${p(0.99).toFixed(2)} ms over the ${BUDGET_P99_MS} ms budget`);
});
