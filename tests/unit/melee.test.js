import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MELEE_PHASE, CLASH, startMelee, stepMelee, inCone, meleeTargets, clashes, applyClash, knockback, forward2 } from '../../src/shared/melee.js';
import { MELEE_STYLES, meleeStyle } from '../../src/shared/weapons.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { validateClientMessage } from '../../src/server/protocol.js';

const mk = (o) => ({ id: 1, x: 0, y: 0, z: 0, yaw: 0, alive: true, kitState: { kit: 'vanguard' }, melee: null, staggerUntil: -Infinity, dash: 0, slide: 0, ...o });

test('SPEC 38.3: a swing walks windup, active, recovery and ends; no second swing mid swing', () => {
  const p = mk({});
  const st = startMelee(p, 1000);
  assert.equal(st.id, 'vanguard');
  assert.equal(startMelee(p, 1001), null, 'already swinging');
  assert.equal(stepMelee(p, 1000 + st.windupMs - 1), MELEE_PHASE.windup);
  assert.equal(stepMelee(p, 1000 + st.windupMs), MELEE_PHASE.active);
  assert.equal(stepMelee(p, 1000 + st.windupMs + st.activeMs), MELEE_PHASE.recovery);
  assert.equal(stepMelee(p, 1000 + st.windupMs + st.activeMs + st.recoveryMs), MELEE_PHASE.none);
  assert.equal(p.melee, null);
  const dead = mk({ alive: false });
  assert.equal(startMelee(dead, 0), null);
  const staggered = mk({ staggerUntil: 5000 });
  assert.equal(startMelee(staggered, 4000), null);
  assert.ok(startMelee(staggered, 5000));
});

test('SPEC 38.3: the cone follows yaw (camera looks down -Z at yaw 0, +yaw turns left)', () => {
  const st = meleeStyle('vanguard');
  const p = mk({});
  assert.ok(inCone(p, mk({ id: 2, z: -2 }), st), 'straight ahead');
  assert.ok(!inCone(p, mk({ id: 2, z: 2 }), st), 'behind');
  assert.ok(!inCone(p, mk({ id: 2, z: -(st.range + 0.1) }), st), 'out of range');
  assert.ok(!inCone(p, mk({ id: 2, z: -2, y: 2 }), st), 'too high');
  p.yaw = Math.PI / 2; // facing -X
  assert.deepEqual(forward2(p.yaw).map((v) => Math.round(v)), [-1, -0]);
  assert.ok(inCone(p, mk({ id: 2, x: -2 }), st));
  assert.ok(!inCone(p, mk({ id: 2, z: -2 }), st));
});

test('SPEC 38.3: targets are the living enemies in the cone during the active window, nearest first, each once', () => {
  const p = mk({});
  startMelee(p, 0);
  const near = mk({ id: 2, z: -1 });
  const far = mk({ id: 3, z: -2.5 });
  const dead = mk({ id: 4, z: -1, alive: false });
  assert.deepEqual(meleeTargets(p, [p, far, near, dead]), [], 'windup hits nothing');
  stepMelee(p, meleeStyle('vanguard').windupMs);
  assert.deepEqual(meleeTargets(p, [p, far, near, dead]).map((q) => q.id), [2, 3]);
  p.melee.hit.push(2);
  assert.deepEqual(meleeTargets(p, [p, far, near]).map((q) => q.id), [3]);
});

test('SPEC 38.3: the clash: both swinging into each other, no damage, the later swing is the riposte and recovers first', () => {
  const a = mk({ id: 1, z: 0, yaw: 0 }); // faces -Z
  const b = mk({ id: 2, z: -2, yaw: Math.PI, kitState: { kit: 'phantom' } }); // faces +Z, toward a
  startMelee(a, 1000);
  startMelee(b, 1040); // b answers 40 ms later
  assert.ok(clashes(a, b) && clashes(b, a));
  const r = applyClash(a, b, 1200);
  assert.equal(r.riposte, b);
  assert.equal(r.staggered, a);
  assert.equal(a.melee.phase, MELEE_PHASE.clash);
  assert.equal(a.staggerUntil, 1200 + CLASH.staggerMs);
  assert.equal(b.staggerUntil, 1200 + CLASH.riposteMs);
  assert.ok(a.dashDz > 0.99 && b.dashDz < -0.99, 'thrown apart along the line between them');
  assert.ok(a.dash > 0 && Math.abs(a.dash - CLASH.knockbackDist / CLASH.knockbackSpeed) < 1e-9);
  assert.equal(stepMelee(b, 1200 + CLASH.riposteMs), MELEE_PHASE.none, 'the riposte is free first');
  assert.equal(stepMelee(a, 1200 + CLASH.riposteMs), MELEE_PHASE.clash, 'the attacker is still staggered');
  assert.equal(stepMelee(a, 1200 + CLASH.staggerMs), MELEE_PHASE.none);
  // a victim who is not swinging, or who faces away, does not clash
  const c = mk({ id: 3, z: -2, yaw: 0 });
  startMelee(a, 3000); startMelee(c, 3000);
  assert.equal(clashes(a, c), false, 'c faces away');
});

test('SPEC 38.3: knockback pushes the victim away from the attacker through the dash lane', () => {
  const p = mk({ x: 0, z: 0 });
  const q = mk({ id: 2, x: 0, z: -1.5, slide: 0.3 });
  knockback(p, q, MELEE_STYLES.vanguard);
  assert.ok(q.dashDz < -0.99 && q.dash > 0 && q.slide === 0);
});

test('SPEC 38.3: protocol accepts a bare melee message', () => {
  assert.deepEqual(validateClientMessage({ t: 'melee' }), { ok: true, msg: { t: 'melee' } });
  assert.equal(validateClientMessage({ t: 'melee', style: 'x' }).ok, true, 'extra fields are ignored');
});

test('SPEC 38.3: the room resolves a swing into damage, knockback and a kill; a clash broadcasts and spares both', () => {
  let now = 50_000;
  const room = new GameRoom({ now: () => now, random: () => 0.5, botFill: 0 });
  const inbox = [];
  const a = room.addPlayer({ send: (m) => inbox.push({ to: 'a', ...m }), name: 'A' });
  const b = room.addPlayer({ send: (m) => inbox.push({ to: 'b', ...m }), name: 'B' });
  room.tick();
  now += 6000; room.tick(); // past spawn protection
  Object.assign(a, { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 });
  Object.assign(b, { x: 0, y: 0, z: -2, yaw: Math.PI, vx: 0, vz: 0 });
  a.protectedUntil = -Infinity; b.protectedUntil = -Infinity;
  const hpBefore = b.hp;
  room.handleMelee(a.id);
  room.tick();
  assert.ok(inbox.some((m) => m.t === 'melee' && m.id === a.id && m.style === 'vanguard'));
  now += MELEE_STYLES.vanguard.windupMs + 20; Object.assign(a, { x: 0, z: 0 }); Object.assign(b, { x: 0, z: -2 }); room.tick();
  assert.equal(b.hp, hpBefore - MELEE_STYLES.vanguard.damage, 'one swing, one hit');
  assert.ok(inbox.some((m) => m.t === 'verdict' && m.to === 'a' && m.zone === 'melee' && m.dmg === MELEE_STYLES.vanguard.damage));
  now += 2000; room.tick();
  // the clash
  Object.assign(a, { x: 0, z: 0, yaw: 0 }); Object.assign(b, { x: 0, z: -2, yaw: Math.PI });
  room.handleMelee(a.id); room.tick();
  now += 40; room.handleMelee(b.id); room.tick();
  now += MELEE_STYLES.vanguard.windupMs; Object.assign(a, { x: 0, z: 0 }); Object.assign(b, { x: 0, z: -2 }); room.tick();
  const clash = inbox.find((m) => m.t === 'clash');
  assert.ok(clash, 'clash broadcast');
  assert.equal(clash.riposte, b.id);
  assert.equal(b.hp, hpBefore - MELEE_STYLES.vanguard.damage, 'no damage in a clash');
  assert.equal(a.hp, 100);
  const snap = inbox.filter((m) => m.t === 'snap').at(-1);
  assert.ok(snap.players.every((pl) => pl.ml === MELEE_PHASE.clash), 'both players show the clash phase');
  // staggered players cannot shoot
  room.handleShoot(a.id); room.tick();
  assert.ok(!inbox.some((m) => m.t === 'shot' && m.id === a.id));
});
