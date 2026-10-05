#!/usr/bin/env node
// Live check (SPEC 36.9): joins live dm-, range- and tdm- rooms over the SDK and prints who else is there.
// A lone human must meet bots in dm, dummies that never shoot in range, and a 4-seat bot fill in tdm. Read-only.
// Usage: node scripts/live-rooms-check.mjs   (room codes are 6 chars from ROOM_CODE_ALPHABET, change them to get fresh rooms)
const site = 'https://base-code-arena-5fefcb78.base44.app/';
globalThis.window ??= { location: { href: site } };
globalThis.localStorage ??= { store: new Map(), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, String(v)); }, removeItem(k) { this.store.delete(k); } };
const { createClient } = await import('@base44/sdk');
const client = createClient({ appId: '6ac103381bbc9fd85fefcb78', requiresAuth: false, actorsTransport: 'direct' });
async function run(room, seconds) {
  const conn = client.actors.Match(room).connect({ id: `smoke-${Math.random().toString(36).slice(2, 8)}` });
  const seen = { players: new Map(), types: {}, hp: [], shots: 0, matchStart: null, first: null };
  conn.subscribe((raw) => {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    seen.types[m.t] = (seen.types[m.t] ?? 0) + 1;
    if (m.t === 'welcome') { seen.first = m;  }
    if (m.t === 'matchStart' || m.t === 'matchLive') seen.matchStart = m;
    if (m.t === 'snap') for (const p of m.players ?? m.p ?? []) { seen.players.set(p.id ?? p.i, p); if ((p.id ?? p.i) === seen.first?.id) seen.hp.push(p.hp ?? p.h); }
    if (m.t === 'shot' || m.t === 'fire') seen.shots += 1;
  });
  await new Promise((r) => setTimeout(r, 1500));
  conn.send({ t: 'join', name: 'Smoke' });
  let seq = 0;
  const t = setInterval(() => conn.send({ t: 'input', cmds: [{ seq: ++seq, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, dive: false, tac: false, yaw: 0, pitch: 0 }], ts: Date.now() }), 100);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(t);
  const others = [...seen.players.values()].filter((p) => (p.id ?? p.i) !== seen.first?.id);
  console.log(JSON.stringify({ room, types: seen.types, me: seen.first?.id, others: others.map((p) => ({ id: p.id ?? p.i, name: p.name ?? p.n, bot: p.bot ?? p.b, team: p.team })), myHp: [seen.hp[0], seen.hp.at(-1)], mode: seen.matchStart?.mode ?? seen.first?.mode, matchKeys: Object.keys(seen.matchStart ?? {}) }));
  try { conn.close?.(); conn.disconnect?.(); } catch {}
}
await run('dm-smk4ab', 12);
await run('range-smk4ab', 12);
await run('tdm-smk4ab', 10);
process.exit(0);
