// Bounded load test: 8 concurrent 60 Hz clients (the per-IP cap) for ~3 s, plus connection churn.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, waitFor, delay, httpRequest, percentile, cmd } from '../helpers/harness.js';

describe('load', () => {
  const ctx = useServer({});

  it('8 clients sending 60 Hz input for 3 s: nobody is dropped, snapshots keep flowing, /healthz stays responsive', { timeout: 20000 }, async () => {
    const clients = [];
    for (let i = 0; i < 8; i++) clients.push(await ctx.open());
    await Promise.all(clients.map((c, i) => c.join(`Bot${i}`)));
    await waitFor(() => ctx.room.playerCount === 8, { what: '8 players' });

    const DURATION_MS = 3000;
    const seqs = clients.map(() => 0);
    const t0 = performance.now();
    const timers = clients.map((c, i) =>
      setInterval(() => {
        if (c.closed || !c.isOpen) return;
        const seq = ++seqs[i];
        c.send({ t: 'input', cmds: [cmd(seq, { fwd: Math.sin(seq / 45) > 0 ? 1 : -1, right: i % 2 ? 1 : -1, yaw: seq * 0.02 })] });
      }, 1000 / 60),
    );
    const latencies = [];
    try {
      while (performance.now() - t0 < DURATION_MS) {
        const res = await httpRequest(ctx.port, { path: '/healthz' });
        assert.equal(res.status, 200);
        latencies.push(res.elapsedMs);
        await delay(200);
      }
    } finally {
      for (const t of timers) clearInterval(t);
    }

    for (const [i, c] of clients.entries()) {
      assert.equal(c.closed, false, `client ${i} was closed unexpectedly (code ${c.closeCode})`);
      assert.ok(c.lastSnap.ack > 0, `client ${i} got acks`);
      assert.ok(c.lastSnap.players.length === 8, `client ${i} sees all 8 players`);
    }

    const pooled = [];
    for (const [i, c] of clients.entries()) {
      const times = c.snapTimes.filter((x) => x >= t0);
      assert.ok(times.length >= 45, `client ${i} received ${times.length} snapshots in ~3 s (expected roughly 90)`);
      const gaps = [];
      for (let k = 1; k < times.length; k++) gaps.push(times[k] - times[k - 1]);
      pooled.push(...gaps);
      const p95 = percentile(gaps, 0.95);
      assert.ok(p95 < 120, `client ${i}: p95 snapshot inter-arrival ${p95.toFixed(1)} ms must be < 120 ms`);
    }
    assert.ok(percentile(pooled, 0.95) < 120);

    const worst = Math.max(...latencies);
    assert.ok(latencies.length >= 5);
    assert.ok(worst < 500, `/healthz worst latency under load ${worst.toFixed(1)} ms`);
    assert.equal((await ctx.readyz()).players, 8);
  });

  it('connection churn (join + leave x25) leaves no ghost players or leaked per-IP slots', { timeout: 20000 }, async () => {
    for (let i = 0; i < 25; i++) {
      const c = await ctx.open({ retry429: true });
      await c.join(`Churn${i}`);
      if (i % 2 === 0) await c.close();
      else c.dispose();
    }
    await waitFor(() => ctx.room.playerCount === 0, { what: 'all churned players removed' });
    const held = [];
    for (let i = 0; i < 8; i++) {
      const r = await ctx.tryOpen({ retry429: true });
      assert.equal(r.ok, true, `slot ${i + 1} available after churn`);
      held.push(r.client);
    }
    assert.equal((await ctx.tryOpen()).status, 429);
  });

  it('8 clients shooting at the cooldown rate do not stall the tick loop', { timeout: 20000 }, async () => {
    const clients = [];
    for (let i = 0; i < 8; i++) clients.push(await ctx.open());
    await Promise.all(clients.map((c, i) => c.join(`Gun${i}`)));
    for (let round = 0; round < 10; round++) {
      for (const c of clients) c.send({ t: 'shoot' });
      await Promise.all(clients.map((c) => c.nextSnaps(3)));
    }
    for (const c of clients) assert.equal(c.closed, false);
    const shotIds = new Set(clients[0].ofType('shot').map((s) => s.id));
    assert.ok(shotIds.size >= 2, 'shots from several shooters were broadcast');
    for (const c of clients) {
      const ticks = c.snaps.map((s) => s.tick);
      for (let k = 1; k < ticks.length; k++) assert.ok(ticks[k] > ticks[k - 1], 'tick strictly increasing');
    }
  });
});
