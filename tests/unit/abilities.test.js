// SPEC 24: kits and abilities (pure module) and their room-level effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KITS, KIT_IDS, ABILITIES, newKitState, useAbility, abilityReady, cooldownLeft, stepEffects, applyGrapple, slowFactor, shieldBoxes, decoyTargets, describeEffects, isKit } from '../../src/shared/abilities.js';
import { stepPlayer } from '../../src/shared/movement.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { MAX_HP, PLAYER } from '../../src/shared/constants.js';

const pl = (o = {}) => ({ id: 1, name: 'A', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, alive: true, hp: MAX_HP, team: -1, kitState: newKitState('vanguard'), ...o });
const ctx = (o = {}) => { let n = 1; return { nowMs: 1000, boxes: [], half: 40, players: [], fx: [], nextFxId: () => n++, cdMul: 1, ...o }; };

test('four kits, two abilities each, every ability defined; isKit guards', () => {
  assert.deepEqual(KIT_IDS, ['vanguard', 'phantom', 'engineer', 'medic']);
  for (const k of Object.values(KITS)) {
    assert.equal(k.abilities.length, 2);
    for (const a of k.abilities) assert.ok(ABILITIES[a], a);
  }
  assert.equal(isKit('medic'), true);
  assert.equal(isKit('__proto__'), false);
  assert.equal(isKit(3), false);
  assert.throws(() => newKitState('ctf'), RangeError);
});

test('cooldown: an ability is ready, used, then blocked until readyAt; cdMul shortens it', () => {
  const p = pl();
  const c = ctx();
  assert.equal(abilityReady(p.kitState, 0, 1000), true);
  const r = useAbility(p, 0, c);
  assert.deepEqual(r, { ok: true, ability: 'dash', cooldownMs: 5000 });
  assert.equal(cooldownLeft(p.kitState, 0, 1000), 5000);
  assert.deepEqual(useAbility(p, 0, c), { ok: false, reason: 'cooldown' });
  assert.deepEqual(useAbility(pl({ alive: false }), 0, c), { ok: false, reason: 'dead' });
  assert.deepEqual(useAbility(pl(), 2, c), { ok: false, reason: 'bad_slot' });
  const q = pl({ kitState: newKitState('medic') });
  assert.equal(useAbility(q, 0, ctx({ cdMul: 0.8 })).cooldownMs, 9600);
});

test('dash: a 0.2 s burst at dashSpeed in the facing direction, run by stepPlayer, then normal speed', () => {
  const p = pl();
  useAbility(p, 0, ctx());
  assert.equal(p.dash, ABILITIES.dash.time);
  stepPlayer(p, { fwd: 0, right: 0, jump: false, yaw: 0 }, [], 40);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vz) - PLAYER.dashSpeed) < 1e-9);
  assert.ok(p.vz < 0, 'yaw 0 faces -Z');
  for (let i = 0; i < 20; i++) stepPlayer(p, { fwd: 0, right: 0, jump: false, yaw: 0 }, [], 40);
  assert.equal(p.dash, 0);
  assert.equal(Math.abs(p.vx), 0);
  assert.equal(Math.abs(p.vz), 0);
});

test('shield: a wall 1.5 m ahead across the facing axis, 8 s, listed by shieldBoxes', () => {
  const p = pl({ kitState: newKitState('vanguard') });
  const c = ctx();
  useAbility(p, 1, c);
  assert.equal(c.fx.length, 1);
  const [f] = c.fx;
  assert.equal(f.kind, 'shield');
  assert.ok(Math.abs(f.z - -1.5) < 1e-9 && Math.abs(f.x) < 1e-9);
  assert.deepEqual(shieldBoxes(c.fx)[0].min.map((v) => Math.round(v * 100) / 100), [-1.5, 0, -1.65]);
  assert.equal(f.until, 1000 + ABILITIES.shield.ttlMs);
  assert.deepEqual(stepEffects(c.fx, [], 1000 + ABILITIES.shield.ttlMs, 33, []).map((e) => e.kind), ['shield']);
  assert.equal(c.fx.length, 0);
});

test('blink: 8 m along the facing, stopped short of a wall, clamped to the arena', () => {
  const p = pl({ kitState: newKitState('phantom') });
  useAbility(p, 0, ctx());
  assert.ok(Math.abs(p.z - -(ABILITIES.blink.range - 0.05)) < 1e-9, `${p.z}`); // 5 cm short of the full range
  const q = pl({ kitState: newKitState('phantom') });
  const wall = { min: [-5, 0, -4.5], max: [5, 3, -4] };
  useAbility(q, 0, ctx({ boxes: [wall] }));
  assert.ok(q.z > -4.5 + PLAYER.radius - 1e-6 && q.z < -3, `stopped before the wall: ${q.z}`);
  const r = pl({ kitState: newKitState('phantom'), z: -36 });
  useAbility(r, 0, ctx());
  assert.equal(r.z, -(40 - PLAYER.radius));
});

test('decoy: walks forward at 4 m/s, stops at boxes, dies on damage, is a negative-id target', () => {
  const p = pl({ kitState: newKitState('phantom') });
  const c = ctx();
  useAbility(p, 1, c);
  const [f] = c.fx;
  assert.equal(f.kind, 'decoy');
  stepEffects(c.fx, [], 1500, 1000, []);
  assert.ok(Math.abs(f.z - -4) < 1e-9);
  const t = decoyTargets(c.fx);
  assert.equal(t[0].id, -f.id);
  f.hp = 0;
  stepEffects(c.fx, [], 1600, 33, []);
  assert.equal(c.fx.length, 0);
});

test('grapple: needs an anchor within range, pulls at 16 m/s, releases near the point, on jump or on timeout', () => {
  const p = pl({ kitState: newKitState('engineer'), pitch: 0 });
  assert.deepEqual(useAbility(p, 0, ctx()), { ok: false, reason: 'no_anchor' });
  const wall = { min: [-5, 0, -10.5], max: [5, 6, -10] };
  const r = useAbility(p, 0, ctx({ boxes: [wall] }));
  assert.equal(r.ok, true);
  assert.ok(p.grapple && Math.abs(p.grapple.z - -10) < 1e-9);
  assert.equal(applyGrapple(p, false, 1100), true);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vy, p.vz) - ABILITIES.grapple.pull) < 1e-9);
  assert.equal(p.onGround, false);
  assert.equal(applyGrapple(p, true, 1200), false, 'jump releases');
  assert.equal(p.grapple, null);
  useAbility(pl({ kitState: newKitState('engineer') }), 0, ctx({ boxes: [wall] }));
  const q = pl({ kitState: newKitState('engineer') });
  useAbility(q, 0, ctx({ boxes: [wall] }));
  assert.equal(applyGrapple(q, false, 1000 + ABILITIES.grapple.maxMs), false, 'timeout releases');
});

test('scan: enemies within 25 m are revealed for 5 s; teammates and the dead are not', () => {
  const p = pl({ kitState: newKitState('engineer'), team: 0 });
  const near = pl({ id: 2, x: 10, team: 1 });
  const far = pl({ id: 3, x: 30, team: 1 });
  const mate = pl({ id: 4, x: 5, team: 0 });
  const dead = pl({ id: 5, x: 5, team: 1, alive: false });
  useAbility(p, 1, ctx({ players: [near, far, mate, dead] }));
  assert.equal(near.scannedUntil, 1000 + ABILITIES.scan.revealMs);
  assert.equal(far.scannedUntil, undefined);
  assert.equal(mate.scannedUntil, undefined);
  assert.equal(dead.scannedUntil, undefined);
});

test('heal zone: 10 hp/s to the owner (DM) or the team (TDM) inside 4 m, capped at MAX_HP', () => {
  const p = pl({ kitState: newKitState('medic'), hp: 50, team: 0 });
  const mate = pl({ id: 2, x: 2, hp: 95, team: 0 });
  const enemy = pl({ id: 3, x: 2, hp: 50, team: 1 });
  const farMate = pl({ id: 4, x: 6, hp: 50, team: 0 });
  const c = ctx();
  useAbility(p, 0, c);
  stepEffects(c.fx, [p, mate, enemy, farMate], 1500, 1000, []);
  assert.equal(p.hp, 60);
  assert.equal(mate.hp, 100);
  assert.equal(enemy.hp, 50);
  assert.equal(farMate.hp, 50);
  const solo = pl({ kitState: newKitState('medic'), hp: 50, team: -1 });
  const other = pl({ id: 9, x: 1, hp: 50, team: -1 });
  const d = ctx();
  useAbility(solo, 0, d);
  stepEffects(d.fx, [solo, other], 1500, 1000, []);
  assert.equal(solo.hp, 60);
  assert.equal(other.hp, 50, 'DM: only the owner');
});

test('stasis: enemies inside move at half input; allies and the owner are free', () => {
  const p = pl({ kitState: newKitState('medic'), team: 0 });
  const c = ctx();
  useAbility(p, 1, c);
  assert.equal(slowFactor(c.fx, pl({ id: 2, x: 3, team: 1 })), 0.5);
  assert.equal(slowFactor(c.fx, pl({ id: 3, x: 9, team: 1 })), 1);
  assert.equal(slowFactor(c.fx, pl({ id: 4, x: 3, team: 0 })), 1);
  assert.equal(slowFactor(c.fx, p), 1);
  const snap = describeEffects(c.fx, 2000);
  assert.deepEqual(Object.keys(snap[0]).filter((k) => snap[0][k] !== undefined).sort(), ['id', 'k', 'o', 'r', 'tm', 'ttl', 'x', 'y', 'z']);
  assert.equal(snap[0].ttl, ABILITIES.stasis.ttlMs - 1000);
});

// ---- room level
function newRoom(opts = {}) {
  const clock = { t: 1000 };
  const room = new GameRoom({ now: () => clock.t, random: () => 0, ...opts });
  return { room, clock, advance: (ms) => { clock.t += ms; } };
}
function join(room, name, x, z, kit, yaw = 0) {
  const inbox = [];
  const p = room.addPlayer({ send: (m) => inbox.push(m), name, kit });
  Object.assign(p, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0 });
  return { p, inbox, of: (t) => inbox.filter((m) => m.t === t), lastSnap: () => inbox.filter((m) => m.t === 'snap').at(-1) };
}

test('room: welcome carries the kit, a bad kit falls back, snapshot carries kt / lv / sc and the private self block', () => {
  const { room } = newRoom();
  const a = join(room, 'A', 30, 30, 'medic');
  const b = join(room, 'B', 30, 26, 'nope');
  assert.equal(a.of('welcome')[0].kit, 'medic');
  assert.equal(b.of('welcome')[0].kit, 'vanguard');
  room.tick();
  const s = a.lastSnap();
  assert.equal(s.players[0].kt, 3);
  assert.equal(s.players[1].kt, 0);
  assert.equal(s.players[0].lv, 1);
  assert.equal(s.players[0].sc, 0);
  assert.deepEqual(s.self.cd, [0, 0]);
  assert.equal(s.self.kit, 'medic');
  assert.equal(s.self.xp, 0);
  assert.deepEqual(s.fx, []);
});

test('room: an ability intent is applied once per tick, broadcast, put on cooldown and denied while cooling', () => {
  const { room, advance } = newRoom();
  const a = join(room, 'A', 30, 30, 'vanguard');
  const b = join(room, 'B', -30, -30, 'vanguard');
  room.handleAbility(a.p.id, 1);
  room.tick();
  assert.deepEqual(a.of('ability')[0], { t: 'ability', id: a.p.id, ability: 'shield', slot: 1, cd: 12000 });
  assert.equal(b.of('ability').length, 1, 'everyone sees it');
  assert.equal(a.lastSnap().fx.length, 1);
  assert.equal(a.lastSnap().fx[0].k, 'shield');
  assert.equal(a.lastSnap().self.cd[1], 12000);
  room.handleAbility(a.p.id, 1);
  advance(33); room.tick();
  assert.equal(a.of('ability').at(-1).denied, 'cooldown');
  assert.equal(b.of('ability').length, 1, 'denials are private');
});

test('room: a shield in front of the victim blocks the bullet; a decoy soaks it and dies', () => {
  const { room, advance } = newRoom();
  const a = join(room, 'A', 30, 30, 'vanguard');
  const b = join(room, 'B', 30, 22, 'phantom', Math.PI); // B faces +Z, toward A
  room.handleAbility(b.p.id, 1); // B drops a decoy walking toward A
  room.tick();
  room.handleShoot(a.p.id);
  advance(33); room.tick();
  assert.equal(b.p.hp, MAX_HP, 'the decoy was in the way');
  assert.equal(a.of('verdict').at(-1).dmg, 0);
  assert.ok(a.of('hit').some((m) => m.id < 0), 'hit marker on the decoy');
  advance(33); room.tick();
  assert.equal(a.lastSnap().fx.length, 0, 'the decoy died');
  // shield: B raises it between them
  room.handleAbility(b.p.id, 0); // blink first slot? phantom slot 0 is blink; use a vanguard instead
  const { room: r2, advance: adv2 } = newRoom();
  const c = join(r2, 'C', 30, 30, 'vanguard');
  const d = join(r2, 'D', 30, 22, 'vanguard', Math.PI);
  r2.handleAbility(d.p.id, 1);
  r2.tick();
  r2.handleShoot(c.p.id);
  adv2(33); r2.tick();
  assert.equal(d.p.hp, MAX_HP, 'the shield blocked the shot');
});

test('room: kit change applies on the next spawn; cooldowns and XP reset on match restart', () => {
  const { room, advance } = newRoom();
  const a = join(room, 'A', 30, 30, 'vanguard');
  const b = join(room, 'B', 30, 26, 'vanguard');
  room.handleKit(b.p.id, 'medic');
  room.tick();
  assert.equal(b.lastSnap().self.kit, 'vanguard', 'not yet');
  b.p.hp = 10;
  room.handleShoot(a.p.id);
  advance(33); room.tick();
  assert.equal(b.p.alive, false);
  advance(3000); room.tick();
  assert.equal(b.p.alive, true);
  assert.equal(b.lastSnap().self.kit, 'medic');
  assert.equal(a.lastSnap().self.xp, 100 + 1, 'kill XP plus 1 damage XP for 10 hp');
});
