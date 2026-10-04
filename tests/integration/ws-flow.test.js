// SPEC section 12 (WebSocket part): join/welcome/snapshots, input -> ack + movement, replay, shots, disconnect.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, waitFor, httpRequest, moveUntilMoved, cmd, STEP, MAX_CMDS_PER_TICK } from '../helpers/harness.js';

const SNAP_ENTRY_KEYS = ['alive', 'd', 'g', 'hp', 'id', 'k', 'name', 'pitch', 'x', 'y', 'yaw', 'z', 'vy', 'w', 'm', 'r', 'rel', 'sp', 'tm', 'h', 'kt', 'lv', 'sc'].sort(); // SPEC 20.4 weapon fields, 21.2 sp, 22 tm, 23 h, 24 kt lv sc

describe('join / welcome / snapshot flow', () => {
  const ctx = useServer({});

  it('join replies with welcome {id:int, tickRate:30}, then snapshots list the player with full hp', async () => {
    const c = await ctx.open();
    c.send({ t: 'join', name: 'Ann' });
    const welcome = await waitFor(() => c.ofType('welcome')[0], { what: 'welcome' });
    assert.equal(welcome.t, 'welcome');
    assert.ok(Number.isInteger(welcome.id));
    assert.equal(welcome.tickRate, 30);
    c.id = welcome.id;
    await waitFor(() => c.snaps.some((s) => s.players.some((p) => p.name === 'Ann')), { what: 'snapshot with Ann' });
    const me = c.snaps.at(-1).players.find((p) => p.id === welcome.id);
    assert.equal(me.name, 'Ann');
    assert.equal(me.hp, 100);
    assert.equal(me.alive, 1);
    assert.equal(me.g, 1, 'spawns standing on the floor');
    assert.equal(me.k, 0);
    assert.equal(me.d, 0);
    assert.equal(me.y, 0);
    assert.deepEqual(Object.keys(me).sort(), SNAP_ENTRY_KEYS, 'snapshot entries expose exactly the specified fields');
    for (const key of ['x', 'y', 'z', 'vy', 'yaw', 'pitch']) assert.ok(Number.isFinite(me[key]), `${key} is a finite number`);
    assert.equal(c.snaps.at(-1).ack, -1, 'ack is -1 before any input is processed');
    assert.equal(ctx.room.playerCount, 1);
  });

  it('welcome arrives before the first snapshot that contains the player', async () => {
    const c = await ctx.open();
    c.send({ t: 'join', name: 'Order' });
    await waitFor(() => c.snaps.some((s) => s.players.some((p) => p.name === 'Order')), { what: 'snapshot' });
    const iWelcome = c.messages.findIndex((m) => m.t === 'welcome');
    const iSnapWithMe = c.messages.findIndex((m) => m.t === 'snap' && m.players.some((p) => p.name === 'Order'));
    assert.ok(iWelcome >= 0 && iWelcome < iSnapWithMe);
  });

  it('snapshot tick counter strictly increases and the cadence is roughly 30 Hz', async () => {
    const c = await ctx.open();
    await c.join('Tick');
    const t0 = performance.now();
    const snaps = await c.nextSnaps(30, 6000);
    const elapsed = performance.now() - t0;
    for (let i = 1; i < snaps.length; i++) assert.ok(snaps[i].tick > snaps[i - 1].tick, 'tick strictly increases');
    const perSnap = elapsed / snaps.length;
    assert.ok(perSnap > 10 && perSnap < 100, `average snapshot interval ${perSnap.toFixed(1)} ms is within 10..100 ms`);
  });

  it('two clients get different ids and each sees the other', async () => {
    const a = await ctx.open();
    const b = await ctx.open();
    const idA = await a.join('Alpha');
    const idB = await b.join('Beta');
    assert.notEqual(idA, idB);
    await waitFor(() => a.lastSnap && a.lastSnap.players.some((p) => p.id === idB && p.name === 'Beta'), { what: 'A sees B' });
    await waitFor(() => b.lastSnap && b.lastSnap.players.some((p) => p.id === idA && p.name === 'Alpha'), { what: 'B sees A' });
    assert.equal(ctx.room.playerCount, 2);
  });

  it('a second join on the same socket is ignored (one player, one welcome, name unchanged)', async () => {
    const c = await ctx.open();
    await c.join('Ann');
    c.send({ t: 'join', name: 'Bob' });
    c.send({ t: 'join', name: 'Carl' });
    await c.nextSnaps(5);
    assert.equal(ctx.room.playerCount, 1);
    assert.equal(c.ofType('welcome').length, 1);
    assert.deepEqual(c.lastSnap.players.map((p) => p.name), ['Ann']);
    assert.equal(c.isOpen, true);
  });

  it('a join without a name gets the default name Player<id>', async () => {
    const c = await ctx.open();
    const id = await c.join(undefined);
    assert.equal(c.me().name, `Player${id}`);
  });

  it('connecting without joining does not create a player and receives no game traffic', async () => {
    const lurker = await ctx.open();
    const joiner = await ctx.open();
    await joiner.join('Real');
    await joiner.nextSnaps(3);
    assert.equal(ctx.room.playerCount, 1);
    assert.equal(lurker.ofType('welcome').length, 0);
    assert.equal(lurker.isOpen, true);
  });
});

describe('input -> ack and movement over the wire', () => {
  const ctx = useServer({});

  it('fwd=1 at yaw 0 decreases z, keeps x, acks the seq, and never exceeds full speed', async () => {
    const { before, after, dist } = await moveUntilMoved(ctx);
    assert.ok(after.z < before.z, 'z decreased');
    assert.ok(Math.abs(after.x - before.x) < 0.01, 'x unchanged for straight -Z motion');
    assert.ok(dist <= 4 * STEP + 0.01, `4 commands moved ${dist} which is at most ${4 * STEP}`);
  });

  it('right=1 at yaw 0 increases x (when not blocked)', async () => {
    const { before, after } = await moveUntilMoved(ctx, { make: (seq) => cmd(seq, { right: 1 }) });
    assert.ok(after.x > before.x);
    assert.ok(Math.abs(after.z - before.z) < 0.01);
  });

  it('a replayed seq does not move the player twice and ack never goes backwards', async () => {
    const { client, after } = await moveUntilMoved(ctx);
    client.send({ t: 'input', cmds: [1, 2, 3, 4].map((s) => cmd(s, { fwd: 1 })) });
    client.send({ t: 'input', cmds: [cmd(2, { fwd: 1 }), cmd(4, { fwd: 1 })] });
    await client.nextSnaps(8);
    const later = client.me();
    assert.equal(later.z, after.z, 'z unchanged after replay');
    assert.equal(later.x, after.x, 'x unchanged after replay');
    let prev = -Infinity;
    for (const s of client.snaps) {
      assert.ok(s.ack >= prev, `ack is monotone (${prev} -> ${s.ack})`);
      prev = s.ack;
    }
    assert.equal(client.lastSnap.ack, 4);
  });

  it('within one message a non-increasing seq is dropped (ack ends at the highest seq)', async () => {
    const c = await ctx.open();
    await c.join('Order');
    c.send({ t: 'input', cmds: [cmd(10), cmd(5), cmd(10), cmd(7)] });
    await waitFor(() => c.lastSnap.ack >= 10, { what: 'ack 10' });
    await c.nextSnaps(5);
    assert.equal(c.lastSnap.ack, 10);
  });

  it('commands are consumed in seq order across several messages and acked', async () => {
    const c = await ctx.open();
    await c.join('Seq');
    for (let s = 1; s <= 20; s++) c.send({ t: 'input', cmds: [cmd(s)] });
    await waitFor(() => c.lastSnap.ack === 20, { what: 'ack 20' });
  });

  it('yaw and pitch are copied into the snapshot; pitch is clamped to 1.5533', async () => {
    const c = await ctx.open();
    await c.join('Look');
    c.send({ t: 'input', cmds: [cmd(1, { yaw: 1.25, pitch: 0.5 })] });
    await waitFor(() => c.lastSnap.ack >= 1);
    assert.ok(Math.abs(c.me().yaw - 1.25) < 0.002);
    assert.ok(Math.abs(c.me().pitch - 0.5) < 0.002);
    c.send({ t: 'input', cmds: [cmd(2, { yaw: 2, pitch: 9 })] });
    await waitFor(() => c.lastSnap.ack >= 2);
    assert.ok(Math.abs(c.me().pitch - 1.553) < 0.002, `pitch clamped, got ${c.me().pitch}`);
    c.send({ t: 'input', cmds: [cmd(3, { pitch: -9 })] });
    await waitFor(() => c.lastSnap.ack >= 3);
    assert.ok(Math.abs(c.me().pitch + 1.553) < 0.002, `negative pitch clamped, got ${c.me().pitch}`);
  });

  it('at most MAX_CMDS_PER_TICK commands are simulated per tick', async () => {
    const c = await ctx.open();
    await c.join('Cap');
    const s0 = await c.waitForMe();
    const tick0 = c.lastSnap.tick;
    c.send({ t: 'input', cmds: Array.from({ length: 8 }, (_, i) => cmd(i + 1, { fwd: 1 })) });
    await waitFor(() => c.lastSnap.ack >= 8);
    const ticks = c.lastSnap.tick - tick0;
    // 8 commands need at least 2 ticks when only 4 are consumed per tick.
    assert.ok(ticks >= 8 / MAX_CMDS_PER_TICK, `8 cmds were consumed over ${ticks} tick(s)`);
    assert.ok(Math.hypot(c.me().x - s0.x, c.me().z - s0.z) <= 8 * STEP + 0.01);
  });
});

describe('shooting', () => {
  const ctx = useServer({});

  it('shoot broadcasts a shot event to every joined player', async () => {
    const a = await ctx.open();
    const b = await ctx.open();
    const idA = await a.join('Shooter');
    await b.join('Watcher');
    await a.waitForMe();
    a.send({ t: 'shoot' });
    for (const c of [a, b]) {
      const shot = await waitFor(() => c.ofType('shot')[0], { what: 'shot event' });
      assert.equal(shot.id, idA);
      assert.equal(shot.from.length, 3);
      assert.equal(shot.to.length, 3);
      for (const v of [...shot.from, ...shot.to]) assert.ok(Number.isFinite(v));
      assert.ok(Math.abs(shot.from[1] - 1.6) < 0.01, `origin at eye height, got y=${shot.from[1]}`);
      const len = Math.hypot(shot.to[0] - shot.from[0], shot.to[1] - shot.from[1], shot.to[2] - shot.from[2]);
      assert.ok(len <= 120 + 0.01, `shot length ${len} within weapon range`);
    }
  });

  it('the shot origin matches the shooter position from the snapshot', async () => {
    const a = await ctx.open();
    await a.join('Origin');
    const me = await a.waitForMe();
    a.send({ t: 'shoot' });
    const shot = await waitFor(() => a.ofType('shot')[0], { what: 'shot' });
    assert.ok(Math.abs(shot.from[0] - me.x) < 0.01);
    assert.ok(Math.abs(shot.from[2] - me.z) < 0.01);
  });

  it('two shoot messages in a row produce a single shot (one pending shot, then cooldown)', async () => {
    const a = await ctx.open();
    await a.join('Rapid');
    a.send({ t: 'shoot' });
    a.send({ t: 'shoot' });
    await waitFor(() => a.ofType('shot').length >= 1, { what: 'first shot' });
    await a.nextSnaps(6);
    assert.equal(a.ofType('shot').length, 1);
  });

  it('a shot event is not sent for a player that never joined', async () => {
    const lurker = await ctx.open();
    const joiner = await ctx.open();
    await joiner.join('J');
    lurker.send({ t: 'shoot' });
    await joiner.nextSnaps(5);
    assert.equal(joiner.ofType('shot').length, 0);
  });
});

describe('disconnect', () => {
  const ctx = useServer({});

  it('closing a joined socket drops room.playerCount and /readyz', async () => {
    const a = await ctx.open();
    const b = await ctx.open();
    await a.join('Stay');
    await b.join('Leave');
    assert.equal(ctx.room.playerCount, 2);
    assert.equal((await ctx.readyz()).players, 2);
    await b.close();
    await waitFor(() => ctx.room.playerCount === 1, { what: 'playerCount 1' });
    await waitFor(async () => (await ctx.readyz()).players === 1, { what: 'readyz players 1' });
    await a.close();
    await waitFor(() => ctx.room.playerCount === 0, { what: 'playerCount 0' });
    await waitFor(async () => (await ctx.readyz()).players === 0, { what: 'readyz players 0' });
  });

  it('an abruptly terminated socket also frees the player', async () => {
    const a = await ctx.open();
    await a.join('Crash');
    assert.equal(ctx.room.playerCount, 1);
    a.dispose();
    await waitFor(() => ctx.room.playerCount === 0, { what: 'playerCount 0 after terminate' });
  });

  it('remaining players stop seeing the departed player in snapshots', async () => {
    const a = await ctx.open();
    const b = await ctx.open();
    await a.join('Keeper');
    const idB = await b.join('Goner');
    await waitFor(() => a.lastSnap.players.some((p) => p.id === idB), { what: 'A sees B' });
    await b.close();
    await waitFor(() => !a.lastSnap.players.some((p) => p.id === idB), { what: 'B removed from snapshots' });
    assert.deepEqual(a.lastSnap.players.map((p) => p.name), ['Keeper']);
  });

  it('closing an unjoined socket does not change the player count', async () => {
    const lurker = await ctx.open();
    const joiner = await ctx.open();
    await joiner.join('Solo');
    await lurker.close();
    await joiner.nextSnaps(3);
    assert.equal(ctx.room.playerCount, 1);
  });

  it('player ids are never reused after a reconnect', async () => {
    const a = await ctx.open();
    const id1 = await a.join('Again');
    await a.close();
    await waitFor(() => ctx.room.playerCount === 0);
    const b = await ctx.open({ retry429: true });
    const id2 = await b.join('Again');
    assert.ok(id2 > id1, `second id ${id2} > first id ${id1}`);
    assert.equal((await httpRequest(ctx.port, { path: '/readyz' })).status, 200);
  });
});
