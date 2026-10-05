// SPEC 40.1: the cosmetics catalog, unlock rules, server resolution and the wire form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, SLOTS, DEFAULT_COSMETICS, isUnlocked, unlockText, resolveCosmetics, packCosmetics, unpackCosmetics, unlockedIds, sanitizeWish, displayName, accentHex, tracerHex, isDefault, itemOf } from '../../src/shared/cosmetics.js';
import { parseClientMessage as parse } from '../../src/server/protocol.js';

const ROOKIE = { kills: 30, matches: 12, wins: 2, best_kills: 7, xp: 1500 };

test('catalog: three slots, unique ids, exactly one free item per slot and it is the default', () => {
  assert.deepEqual(SLOTS, ['badge', 'accent', 'tracer']);
  for (const slot of SLOTS) {
    const ids = CATALOG[slot].map((it) => it.id);
    assert.equal(new Set(ids).size, ids.length, slot);
    const free = CATALOG[slot].filter((it) => !it.unlock);
    assert.equal(free.length, 1, `${slot} has one free item`);
    assert.equal(free[0].id, DEFAULT_COSMETICS[slot]);
    for (const it of CATALOG[slot]) if (it.unlock) assert.ok(['matches', 'kills', 'best_kills', 'wins', 'xp'].includes(it.unlock.stat), it.id);
  }
});

test('unlocks read the stats row; a guest (null row) only has the free items', () => {
  assert.deepEqual(unlockedIds(null), { badge: ['none'], accent: ['team'], tracer: ['standard'] });
  assert.deepEqual(unlockedIds(ROOKIE), { badge: ['none', 'rookie'], accent: ['team', 'ember', 'frost'], tracer: ['standard', 'plasma'] });
  assert.equal(isUnlocked(itemOf('tracer', 'crimson'), { kills: 50 }), true, 'exactly at the threshold counts');
  assert.equal(isUnlocked(itemOf('tracer', 'crimson'), { kills: '50' }), true, 'a numeric string still counts');
  assert.equal(isUnlocked(itemOf('tracer', 'crimson'), { kills: 'lots' }), false);
  assert.equal(unlockText(itemOf('tracer', 'crimson'), ROOKIE), 'Unlock: 50 kills (30/50)');
  assert.equal(unlockText(itemOf('tracer', 'crimson'), null), 'Unlock: 50 kills (0/50)');
  assert.equal(unlockText(itemOf('badge', 'none')), '');
});

test('resolve: locked or unknown wishes fall back to the slot default, never to another item', () => {
  assert.deepEqual(resolveCosmetics({ badge: 'legend', accent: 'gold', tracer: 'plasma' }, ROOKIE), { badge: 'none', accent: 'team', tracer: 'plasma' });
  assert.deepEqual(resolveCosmetics({ badge: 'rookie', accent: 'frost', tracer: 'nope' }, ROOKIE), { badge: 'rookie', accent: 'frost', tracer: 'standard' });
  assert.deepEqual(resolveCosmetics({ badge: 'rookie' }, null), DEFAULT_COSMETICS, 'guests get nothing but the defaults');
  assert.deepEqual(resolveCosmetics(undefined, ROOKIE), DEFAULT_COSMETICS);
  assert.deepEqual(resolveCosmetics({ badge: 'legend', __proto__: { accent: 'gold' } }, { xp: 99999 }), { badge: 'legend', accent: 'team', tracer: 'standard' });
});

test('wire form: null when default, catalog indexes otherwise, round trips, tolerates junk', () => {
  assert.equal(packCosmetics(DEFAULT_COSMETICS), null);
  assert.equal(isDefault(null), true);
  const cs = { badge: 'rookie', accent: 'frost', tracer: 'plasma' };
  assert.deepEqual(packCosmetics(cs), [1, 2, 2]);
  assert.deepEqual(unpackCosmetics([1, 2, 2]), cs);
  assert.deepEqual(unpackCosmetics([99, -1, 'x']), { badge: 'none', accent: 'team', tracer: 'standard' });
  assert.deepEqual(unpackCosmetics('garbage'), DEFAULT_COSMETICS);
});

test('display helpers: badge glyph in front of the name, accent hex or null for team colour, tracer colour', () => {
  assert.equal(displayName('Zed', null), 'Zed');
  assert.equal(displayName('Zed', { badge: 'ace' }), '\u2605 Zed');
  assert.equal(accentHex(null), null);
  assert.equal(accentHex({ accent: 'gold' }), '#ffd23f');
  assert.equal(tracerHex(null), '#ffe08a');
  assert.equal(tracerHex({ tracer: 'crimson' }), '#ff4d4d');
});

test('sanitizeWish keeps only string slot values; the protocol accepts join and cosmetics messages with a wish', () => {
  assert.deepEqual(sanitizeWish({ badge: 'ace', accent: 7, tracer: 'x'.repeat(25), extra: 'no' }), { badge: 'ace' });
  assert.deepEqual(sanitizeWish(null), {});
  const j = parse(JSON.stringify({ t: 'join', name: 'A', cosmetics: { badge: 'ace', bogus: 1 } }));
  assert.equal(j.ok, true);
  assert.deepEqual(j.msg.cosmetics, { badge: 'ace' });
  assert.equal('cosmetics' in parse(JSON.stringify({ t: 'join', name: 'A', cosmetics: 'ace' })).msg, false, 'a non-object wish is dropped, the join still passes');
  const c = parse(JSON.stringify({ t: 'cosmetics', cosmetics: { tracer: 'crimson' } }));
  assert.deepEqual(c.msg, { t: 'cosmetics', cosmetics: { tracer: 'crimson' } });
  assert.equal(parse(JSON.stringify({ t: 'cosmetics' })).ok, false);
});
