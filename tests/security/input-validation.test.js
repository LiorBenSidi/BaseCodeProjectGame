// SPEC sections 6, 7, 10, 12: hostile names, smuggled fields, authority of the server over state.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useServer, waitFor, cmd, STEP, MAX_CMDS_PER_TICK, moveUntilMoved, damageViaRoom } from '../helpers/harness.js';

const SNAP_ENTRY_KEYS = ['alive', 'd', 'g', 'hp', 'id', 'k', 'name', 'pitch', 'vy', 'x', 'y', 'yaw', 'z'].sort();
const NAME_CHARSET = /^[\p{L}\p{N} _-]*$/u;

describe('hostile join names', () => {
  const ctx = useServer({});

  async function joinWith(name) {
    const c = await ctx.open({ retry429: true });
    const id = await c.join(name);
    await c.nextSnaps(2);
    const me = c.me();
    assert.ok(me, 'player present in snapshot');
    return { c, id, me };
  }

  function assertSafeName(name, id) {
    assert.equal(typeof name, 'string');
    assert.ok(NAME_CHARSET.test(name), `name only has letters/digits/space/_/-: ${JSON.stringify(name)}`);
    assert.ok(!/[<>]/.test(name), 'no angle brackets');
    assert.ok([...name].length <= 16, `at most 16 code points, got ${[...name].length}`);
    assert.ok(name.length > 0, 'never empty in a snapshot');
    assert.equal(name, name.trim(), 'trimmed');
    assert.ok(!/ {2}/.test(name), 'runs of spaces collapsed');
    void id;
  }

  const hostile = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '"><svg/onload=alert(1)>',
    "'; DROP TABLE players; --",
    '${7*7}{{7*7}}',
    '＜ｓｃｒｉｐｔ＞',
    '‹script›',
    '﹤b﹥',
    'Bo\u0000b\r\nX\u001b[0m‮Evil​',
    'A\tB\tC',
    '😀😀😀 Emoji 😀',
    '../../etc/passwd',
    '\\u003cscript\\u003e',
    '%3Cscript%3E',
    '&lt;script&gt;',
  ];
  for (const name of hostile) {
    it(`sanitises ${JSON.stringify(name).slice(0, 50)} and no message ever contains < or >`, async () => {
      const { c, id, me } = await joinWith(name);
      assertSafeName(me.name, id);
      const wire = JSON.stringify(c.messages);
      assert.ok(!/[<>]/.test(wire), 'no < or > anywhere on the wire for this client');
    });
  }

  it('other clients also never receive < or > from a hostile name', async () => {
    const watcher = await ctx.open();
    await watcher.join('Watcher');
    await joinWith('<img src=x onerror=alert(1)>');
    await watcher.nextSnaps(4);
    assert.ok(!/[<>]/.test(JSON.stringify(watcher.messages)));
    for (const p of watcher.lastSnap.players) assert.ok(NAME_CHARSET.test(p.name));
  });

  it('a name that sanitises to nothing becomes Player<id>', async () => {
    for (const raw of ['<<<>>>', '     ', '!!!???', '\u0000\u0001', '😀😀']) {
      const { id, me } = await joinWith(raw);
      assert.equal(me.name, `Player${id}`, `raw ${JSON.stringify(raw)}`);
    }
  });

  it('non-string names become Player<id>', async () => {
    for (const raw of [123, null, ['a'], { a: 1 }, true]) {
      const { id, me } = await joinWith(raw);
      assert.equal(me.name, `Player${id}`, `raw ${JSON.stringify(raw)}`);
    }
  });

  it('a 1000-character name is cut to exactly 16 characters', async () => {
    const { me } = await joinWith('A'.repeat(1000));
    assert.equal(me.name, 'A'.repeat(16));
  });

  it('the 16 character limit counts code points, not UTF-16 units', async () => {
    const { me } = await joinWith('\u{1D49C}'.repeat(20));
    assert.equal(me.name, '\u{1D49C}'.repeat(16));
    for (let i = 0; i < me.name.length; i++) {
      const code = me.name.charCodeAt(i);
      const isHigh = code >= 0xd800 && code <= 0xdbff;
      const next = me.name.charCodeAt(i + 1);
      if (isHigh) assert.ok(next >= 0xdc00 && next <= 0xdfff, 'no lone surrogate');
    }
  });

  it('spaces are trimmed and collapsed; letters, digits, underscore and hyphen survive', async () => {
    const { me } = await joinWith('   a     b   ');
    assert.equal(me.name, 'a b');
    const second = await joinWith('Ann_Lee-2');
    assert.equal(second.me.name, 'Ann_Lee-2');
  });

  it('non-Latin letters are kept (Unicode letters and digits are allowed)', async () => {
    const { me } = await joinWith('שלום Ωmega ٣');
    assert.ok(NAME_CHARSET.test(me.name));
    assert.ok(me.name.includes('שלום'));
    assert.ok(me.name.includes('Ωmega'));
  });

  it('players may share a display name without merging or overriding each other', async () => {
    const a = await joinWith('Twin');
    const b = await joinWith('Twin');
    assert.notEqual(a.id, b.id);
    assert.equal(ctx.room.playerCount, 2);
  });
});

describe('smuggled fields have no effect', () => {
  const ctx = useServer({});

  it('extra fields on join (__proto__, isAdmin, hp, position) are ignored and nothing is polluted', async () => {
    const c = await ctx.open();
    c.sendRaw('{"t":"join","name":"Eve","__proto__":{"isAdmin":true,"hp":1},"constructor":{"prototype":{"polluted":1}},"isAdmin":true,"hp":1,"x":999,"y":999,"z":999,"alive":false,"kills":50,"id":1}');
    const welcome = await waitFor(() => c.ofType('welcome')[0], { what: 'welcome' });
    c.id = welcome.id;
    await c.nextSnaps(3);
    const me = c.me();
    assert.equal(me.name, 'Eve');
    assert.equal(me.hp, 100);
    assert.equal(me.alive, 1);
    assert.equal(me.k, 0);
    assert.notEqual(me.x, 999);
    assert.notEqual(me.z, 999);
    assert.ok(Math.abs(me.x) < 500 && Math.abs(me.z) < 500, 'spawned inside the map, not where the client asked');
    assert.deepEqual(Object.keys(me).sort(), SNAP_ENTRY_KEYS);
    assert.equal({}.isAdmin, undefined, 'Object.prototype not polluted (isAdmin)');
    assert.equal({}.hp, undefined, 'Object.prototype not polluted (hp)');
    assert.equal({}.polluted, undefined, 'Object.prototype not polluted (constructor.prototype)');
  });

  it('extra fields inside commands (dt, x, z, hp, vx, isAdmin, __proto__) do not teleport, heal or speed up', async () => {
    const { client, before, after, dist } = await moveUntilMoved(ctx, {
      seqs: [1],
      make: (seq) => ({
        ...cmd(seq, { fwd: 1 }),
        dt: 10,
        x: 500,
        y: 500,
        z: 500,
        vx: 1000,
        vz: -1000,
        hp: 9999,
        isAdmin: true,
        speed: 1000,
      }),
      minDist: 0.05,
    });
    assert.ok(dist <= STEP + 0.01, `a single command moved ${dist}, at most one step (${STEP})`);
    assert.ok(Math.abs(after.z - before.z) <= STEP + 0.01);
    assert.equal(after.hp, 100);
    assert.equal(client.closed, false);
  });

  it('raw JSON with __proto__/constructor inside a command does not pollute Object.prototype', async () => {
    const c = await ctx.open();
    await c.join('Proto');
    c.sendRaw('{"t":"input","cmds":[{"seq":1,"fwd":0,"right":0,"jump":false,"yaw":0,"pitch":0,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}]}');
    c.sendRaw('{"__proto__":{"t":"input","polluted3":true},"t":"shoot"}');
    await waitFor(() => c.lastSnap.ack >= 1, { what: 'ack 1' });
    assert.equal({}.polluted, undefined);
    assert.equal({}.polluted2, undefined);
    assert.equal({}.polluted3, undefined);
    assert.equal(c.closed, false);
  });

  it('a mixed message with one bad command is rejected as a whole (valid command not applied)', async () => {
    const c = await ctx.open();
    await c.join('Atomic');
    const bad = { ...cmd(6), fwd: 'x' };
    c.send({ t: 'input', cmds: [cmd(5), bad] });
    // If the whole message was rejected, seq 3 is not "older than 5", so it is acked; otherwise seq 5 wins.
    c.send({ t: 'input', cmds: [cmd(3)] });
    await waitFor(() => c.lastSnap.ack >= 3, { what: 'ack >= 3' });
    await c.nextSnaps(5);
    assert.equal(c.lastSnap.ack, 3, 'seq 5 from the rejected message must not have been queued');
  });

  it('a message with 9 commands is rejected entirely', async () => {
    const c = await ctx.open();
    await c.join('Nine');
    c.send({ t: 'input', cmds: Array.from({ length: 9 }, (_, i) => cmd(i + 100)) });
    c.send({ t: 'input', cmds: [cmd(1)] });
    await waitFor(() => c.lastSnap.ack >= 1);
    await c.nextSnaps(5);
    assert.equal(c.lastSnap.ack, 1, 'none of the 9 commands were queued');
  });

  it('a client cannot spoof another player via id, from a shoot, or a "kill" message', async () => {
    const a = await ctx.open();
    const b = await ctx.open();
    const idA = await a.join('Aaa');
    const idB = await b.join('Bbb');
    b.sendRaw(JSON.stringify({ t: 'shoot', id: idA, from: [0, 0, 0], to: [1, 1, 1], damage: 1000, target: idA }));
    b.sendRaw(JSON.stringify({ t: 'kill', killer: idB, victim: idA }));
    b.sendRaw(JSON.stringify({ t: 'hit', id: idA }));
    await b.nextSnaps(6);
    const shots = b.ofType('shot');
    assert.ok(shots.every((s) => s.id === idB), 'shot events are attributed to the real sender');
    // b's own legitimate shot could in principle graze a, but a single shot can never do more than 25 damage.
    assert.ok(a.lastSnap.players.find((p) => p.id === idA).hp >= 75);
    assert.equal(a.ofType('kill').length, 0);
  });
});

describe('the server owns position, health and speed', () => {
  const ctx = useServer({});

  it('a client claiming a huge fwd/right is clamped: 4 commands move at most 4 steps at full speed', async () => {
    const { dist } = await moveUntilMoved(ctx, { make: (seq) => cmd(seq, { fwd: 1e9, right: 1e9 }) });
    assert.ok(dist <= 4 * STEP + 0.01, `moved ${dist}, allowed ${4 * STEP}`);
  });

  it('diagonal input is not faster than straight input', async () => {
    const { dist } = await moveUntilMoved(ctx, { make: (seq) => cmd(seq, { fwd: 1, right: 1 }) });
    assert.ok(dist <= 4 * STEP + 0.01, `diagonal moved ${dist}, allowed ${4 * STEP}`);
  });

  it('sending 1000 input commands cannot beat MAX_CMDS_PER_TICK * speed per elapsed server tick', async () => {
    const c = await ctx.open();
    await c.join('Flood');
    const start = await c.waitForMe();
    const tick0 = c.lastSnap.tick;
    let seq = 1;
    const burst = (messages) => {
      for (let i = 0; i < messages; i++) {
        const cmds = [];
        for (let k = 0; k < 8; k++) cmds.push(cmd(seq++, { fwd: 1 }));
        c.send({ t: 'input', cmds });
      }
    };
    burst(100); // 800 commands, within the 120-message bucket
    await c.nextSnaps(10);
    burst(25); // +200 = 1000 commands, after the bucket has refilled
    await c.nextSnaps(15);
    assert.equal(c.closed, false, 'the sender stayed within the rate limit');
    const end = c.me();
    const ticks = c.lastSnap.tick - tick0;
    const dist = Math.hypot(end.x - start.x, end.z - start.z);
    const limit = MAX_CMDS_PER_TICK * ticks * STEP + 0.01;
    assert.ok(dist <= limit, `moved ${dist.toFixed(3)} in ${ticks} ticks; limit ${limit.toFixed(3)}`);
    assert.ok(c.lastSnap.ack <= 1000);
  });

  it('a client cannot jump higher or fly by repeating jump commands', async () => {
    const c = await ctx.open();
    await c.join('Jumper');
    const start = await c.waitForMe();
    const tick0 = c.lastSnap.tick;
    for (let m = 0; m < 20; m++) c.send({ t: 'input', cmds: Array.from({ length: 8 }, (_, i) => cmd(m * 8 + i + 1, { jump: true })) });
    let maxY = 0;
    for (let i = 0; i < 20; i++) {
      await c.nextSnaps(1);
      maxY = Math.max(maxY, c.me().y);
    }
    // Single jump apex is jump^2 / (2 * gravity) = 64 / 48 ~= 1.33; repeated jumping on flat ground stays a few metres at most.
    assert.ok(maxY < 3, `max height ${maxY}`);
    assert.ok(c.me().y >= 0, 'never below the floor');
    assert.ok(c.lastSnap.tick > tick0);
    void start;
  });

  it('positions in snapshots always stay inside sane bounds even under nonsense yaw', async () => {
    const c = await ctx.open();
    await c.join('Spinner');
    for (let m = 0; m < 30; m++) {
      c.send({ t: 'input', cmds: Array.from({ length: 8 }, (_, i) => cmd(m * 8 + i + 1, { fwd: 1, yaw: (m * 8 + i) * 1234.5 })) });
      if (m % 10 === 9) await c.nextSnaps(10);
    }
    await c.nextSnaps(10);
    const p = c.me();
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch']) assert.ok(Number.isFinite(p[k]), `${k} finite`);
    assert.ok(p.y >= 0);
    assert.ok(c.isOpen);
  });

  it('a damaged player cannot restore hp by claiming it in messages or by rejoining', async () => {
    const victim = await ctx.open();
    await victim.join('Victim');
    const hit = await damageViaRoom(ctx, victim);
    assert.ok(hit, 'the injected shooter managed to hit the victim from at least one bearing');
    assert.equal(victim.me().hp, 75);
    victim.sendRaw('{"t":"join","name":"Victim","hp":100}');
    victim.sendRaw('{"t":"input","cmds":[{"seq":1,"fwd":0,"right":0,"jump":false,"yaw":0,"pitch":0,"hp":100,"alive":true}]}');
    victim.sendRaw('{"t":"heal","hp":100}');
    await victim.nextSnaps(8);
    assert.equal(victim.me().hp, 75, 'hp is server-authoritative');
    assert.equal(victim.ofType('welcome').length, 1, 'the second join created nothing');
    assert.equal(victim.closed, false);
  });
});
