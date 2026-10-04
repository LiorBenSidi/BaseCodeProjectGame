import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKit, saveKit, deriveAbilityChips, deriveXpBar, perkCards } from '../../src/client/kitUi.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('kit persists in storage with a safe default', () => {
  const s = mem();
  assert.equal(loadKit(s), 'vanguard');
  saveKit(s, 'medic');
  assert.equal(loadKit(s), 'medic');
  s.setItem('bca.kit', 'bogus');
  assert.equal(loadKit(s), 'vanguard');
  assert.equal(loadKit(null), 'vanguard');
});

test('ability chips show readiness, fraction and seconds', () => {
  const chips = deriveAbilityChips('engineer', [0, 2500]);
  assert.deepEqual(chips.map((c) => [c.name, c.key, c.ready]), [['Grapple', 'Q', true], ['Scan', 'E', false]]);
  assert.equal(chips[1].frac, 0.25);
  assert.equal(chips[1].secs, 3);
  assert.equal(deriveAbilityChips('nope')[0].id, 'dash');
});

test('xp bar fraction and label; max level pins at 1', () => {
  assert.deepEqual(deriveXpBar({ xp: 50, lvl: 1 }), { lvl: 1, frac: 0.5, label: 'LVL 1  50 / 100 XP' });
  assert.deepEqual(deriveXpBar({ xp: 900, lvl: 5 }), { lvl: 5, frac: 1, label: 'LVL 5  MAX' });
  assert.equal(deriveXpBar(null).lvl, 1);
});

test('perk cards map the offer to keys 3 and 4', () => {
  assert.deepEqual(perkCards(['grenadier', 'thick_skin']).map((c) => [c.key, c.name]), [['3', 'Grenadier'], ['4', 'Thick Skin']]);
  assert.deepEqual(perkCards(null), []);
});
