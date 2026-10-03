// SPEC §15.4 over a real socket (D-010 to D-015): verdicts reach the shooter, grenades replicate and explode.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, waitFor } from '../helpers/harness.js';

describe('combat over the wire', () => {
  const ctx = useServer({});

  it('every accepted shot produces a verdict for the shooter, even a miss', async () => {
    const c = await ctx.open();
    await c.join('Shooter');
    c.send({ t: 'shoot' });
    const v = await waitFor(() => c.ofType('verdict')[0], { what: 'verdict' });
    assert.deepEqual(Object.keys(v).sort(), ['dist', 'dmg', 'kill', 't', 'target', 'zone']);
    assert.equal(v.target, null, 'alone in the room: a miss');
    assert.equal(v.zone, null);
    assert.equal(v.dmg, 0);
    assert.ok(v.dist > 0);
  });

  it('a hit verdict names the zone and the applied damage', async () => {
    const victim = await ctx.open();
    await victim.join('Victim');
    const v = await victim.waitForMe();
    const shooter = ctx.room.addPlayer({ send: (m) => shooter.inbox.push(m), name: 'Bot' });
    shooter.inbox = [];
    Object.assign(shooter, { x: v.x, y: 0, z: v.z + 3, yaw: 0, pitch: 0 });
    ctx.room.handleShoot(shooter.id);
    const verdict = await waitFor(() => shooter.inbox.find((m) => m.t === 'verdict'), { what: 'bot verdict' });
    ctx.room.removePlayer(shooter.id);
    assert.equal(verdict.target, victim.id);
    assert.equal(verdict.zone, 'head');
    assert.equal(verdict.dmg, 37.5);
    await waitFor(() => victim.me().hp === 62.5, { what: 'victim hp in snapshot' });
  });

  it('a thrown grenade appears in snapshots, then explodes about 3 s later and every client sees the boom', async () => {
    const t = await ctx.open();
    const o = await ctx.open();
    const tid = await t.join('Thrower');
    await o.join('Watcher');
    const sent = Date.now();
    t.send({ t: 'throw' });
    await waitFor(() => o.lastSnap && o.lastSnap.nades.length === 1, { what: 'grenade replicated to the watcher' });
    const boom = await waitFor(() => o.ofType('boom')[0], { timeoutMs: 6000, what: 'boom' });
    const elapsed = Date.now() - sent;
    assert.equal(boom.owner, tid);
    assert.ok(elapsed >= 2800 && elapsed < 5000, `fuse took ${elapsed} ms`);
    await waitFor(() => t.ofType('boom').length === 1, { what: 'thrower sees the boom' });
    await waitFor(() => o.lastSnap.nades.length === 0, { what: 'grenade removed' });
  });
});
