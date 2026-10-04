// SPEC 21.1 pickups and 21.2 spawn selection (pure modules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPickups, stepPickups, applyPickup, availableIndices, describePickups, inReach } from '../../src/shared/pickups.js';
import { pickSpawn } from '../../src/shared/spawning.js';
import { PICKUP_TYPES } from '../../src/shared/rules.js';
import { MAP } from '../../src/shared/map.js';
import { newLoadout } from '../../src/shared/weapons.js';
import { MAX_HP } from '../../src/shared/constants.js';

const player = (id, x, z, extra = {}) => ({ id, x, y: 0, z, hp: MAX_HP, alive: true, loadout: newLoadout(), ...extra });

test('the arena declares valid pickup spots and buildPickups drops malformed ones', () => {
  const built = buildPickups(MAP.pickups);
  assert.equal(built.length, MAP.pickups.length);
  assert.ok(built.length >= 6);
  for (const pk of built) assert.ok(PICKUP_TYPES[pk.type], pk.type);
  assert.deepEqual(buildPickups([{ type: 'gold', x: 0, z: 0 }, { type: 'health', x: NaN, z: 0 }, { type: 'health', x: 1, z: 2 }]).map((p) => [p.i, p.type]), [[0, 'health']]);
  assert.deepEqual(describePickups(built)[0], { i: 0, type: 'sniper', x: 0, y: 2, z: 0 });
});

test('a health spot heals up to the cap, refuses a full player, and comes back after respawnMs', () => {
  const pickups = buildPickups([{ type: 'health', x: 5, z: 5 }]);
  const full = player(1, 5, 5);
  const hurt = player(2, 5.5, 5, { hp: 70 });
  assert.deepEqual(stepPickups(pickups, [full, hurt], 1000), [{ playerId: 2, i: 0, kind: 'health', amount: 30 }]);
  assert.equal(hurt.hp, MAX_HP);
  assert.deepEqual(availableIndices(pickups, 1000), []);
  assert.deepEqual(availableIndices(pickups, 1000 + PICKUP_TYPES.health.respawnMs), [0]);
});

test('ammo adds one magazine of the weapon in hand to its reserve; a weapon spot swaps the primary', () => {
  const p = player(1, 0, 0);
  assert.equal(applyPickup(buildPickups([{ type: 'ammo', x: 0, z: 0 }])[0], p).amount, 30);
  assert.equal(p.loadout.primary.reserve, 120);
  p.loadout.active = 'sidearm';
  assert.equal(applyPickup(buildPickups([{ type: 'ammo', x: 0, z: 0 }])[0], p).amount, 12);
  p.loadout.active = 'primary';
  const got = applyPickup(buildPickups([{ type: 'shotgun', x: 0, z: 0 }])[0], p);
  assert.deepEqual(got, { kind: 'weapon', amount: 0, weapon: 'shotgun' });
  assert.equal(p.loadout.primary.id, 'shotgun');
  assert.equal(p.loadout.primary.mag, 8);
  assert.equal(applyPickup(buildPickups([{ type: 'shotgun', x: 0, z: 0 }])[0], p), null, 'a full identical weapon is left for others');
});

test('reach is horizontal radius plus a height tolerance; dead players take nothing; one taker per tick', () => {
  const pk = buildPickups([{ type: 'health', x: 0, y: 2, z: 0 }])[0];
  assert.equal(inReach(pk, { x: 1.1, y: 2, z: 0 }), true);
  assert.equal(inReach(pk, { x: 1.3, y: 2, z: 0 }), false);
  assert.equal(inReach(pk, { x: 0, y: 0, z: 0 }), false, 'on the ground under the platform');
  const a = player(1, 0, 0, { hp: 50, y: 2, alive: false });
  const b = player(2, 0.5, 0, { hp: 50, y: 2 });
  const c = player(3, -0.5, 0, { hp: 50, y: 2 });
  const taken = stepPickups([pk], [a, b, c], 0);
  assert.equal(taken.length, 1);
  assert.equal(taken[0].playerId, 2);
  assert.equal(c.hp, 50);
});

test('pickSpawn: random index without enemies, farthest-from-enemies with them, ties by random', () => {
  const spawns = [{ x: -10, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 }];
  assert.equal(pickSpawn(spawns, [], () => 0.5), spawns[1]);
  assert.equal(pickSpawn(spawns, [{ x: -10, z: 0, alive: true }], () => 0), spawns[1]);
  assert.equal(pickSpawn(spawns, [{ x: -10, z: 0, alive: false }], () => 0), spawns[0], 'the dead do not count');
  const tied = pickSpawn([{ x: -10, z: 0 }, { x: 10, z: 0 }], [{ x: 0, z: 0, alive: true }], () => 0.9);
  assert.deepEqual(tied, { x: 10, z: 0 });
});
