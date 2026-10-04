// SPEC 25: XP, levels, perks (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XP, LEVELS, PERKS, PERK_IDS, newProgress, levelFor, grantXp, pickPerk, recordDamage, assistsFor, progressSnapshot } from '../../src/shared/progression.js';

test('levels follow the thresholds', () => {
  assert.deepEqual(LEVELS, [0, 100, 250, 500, 850]);
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(99), 1);
  assert.equal(levelFor(100), 2);
  assert.equal(levelFor(849), 4);
  assert.equal(levelFor(5000), 5);
});

test('a level-up offers two distinct perks; picking applies the mods and closes the offer; invalid picks are refused', () => {
  const pr = newProgress();
  assert.deepEqual(grantXp(pr, 50, () => 0), { leveled: false, offer: null });
  const r = grantXp(pr, 50, () => 0);
  assert.equal(r.leveled, true);
  assert.deepEqual(r.offer, ['faster_reload', 'cooldown']);
  assert.equal(pickPerk(pr, 'grenadier'), null, 'not in the offer');
  assert.equal(pickPerk(pr, 'cooldown').id, 'cooldown');
  assert.equal(pr.offer, null);
  assert.equal(pr.mods.cdMul, 0.8);
  assert.equal(pickPerk(pr, 'cooldown'), null, 'nothing offered now');
  // next level: the taken perk is out of the pool
  grantXp(pr, 150, () => 0);
  assert.deepEqual(pr.offer, ['faster_reload', 'grenadier']);
  pickPerk(pr, 'grenadier');
  assert.equal(pr.mods.grenades, 1);
  assert.deepEqual(pr.perks, ['cooldown', 'grenadier']);
});

test('two level-ups at once queue a second offer after the first pick', () => {
  const pr = newProgress();
  grantXp(pr, 250, () => 0.99);
  assert.equal(pr.level, 3);
  assert.ok(pr.offer);
  const first = pr.offer[0];
  pickPerk(pr, first);
  assert.equal(pr.offer, null);
  grantXp(pr, 0, () => 0.99);
  assert.ok(pr.offer, 'the queued offer opens');
  assert.ok(!pr.offer.includes(first));
});

test('damage XP: 1 per 10 hp, capped at 10 per victim; assists within 10 s, killer excluded, book cleared', () => {
  const a = newProgress();
  const v = newProgress();
  assert.equal(recordDamage(a, v, 1, 2, 37, 1000), 3);
  assert.equal(recordDamage(a, v, 1, 2, 95, 1000), 7, 'capped at 10 total');
  assert.equal(recordDamage(a, v, 1, 2, 50, 1000), 0);
  assert.equal(recordDamage(a, v, 1, 1, 50, 1000), 0, 'self damage');
  const b = newProgress();
  recordDamage(b, v, 3, 2, 20, 5000);
  assert.deepEqual(assistsFor(v, 3, 6000), [1], 'the killer is not an assist');
  assert.deepEqual(assistsFor(v, 1, 6000), [], 'cleared');
  recordDamage(a, v, 1, 2, 20, 1000);
  assert.deepEqual(assistsFor(v, 9, 1000 + XP.assistWindowMs + 1), [], 'too old');
});

test('perk table and snapshot shape', () => {
  assert.equal(PERK_IDS.length, 5);
  for (const p of Object.values(PERKS)) assert.ok(p.name && p.blurb && p.mods);
  const pr = newProgress();
  assert.deepEqual(progressSnapshot(pr), { xp: 0, lvl: 1 });
  grantXp(pr, 100, () => 0);
  assert.deepEqual(Object.keys(progressSnapshot(pr)).sort(), ['lvl', 'offer', 'xp']);
});
