import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTLINE_MODES, OUTLINE_SCALE, isOutlineMode, outlineColorHex, isEnemyOf } from '../../src/client/outline.js';
import { PREFS_SCHEMA as PREFS, defaults as prefDefaults } from '../../src/client/prefs.js';

test('SPEC 37.5: outline modes, colours and the hull scale', () => {
  assert.deepEqual([...OUTLINE_MODES], ['off', 'yellow', 'red', 'purple']);
  assert.equal(isOutlineMode('purple'), true);
  assert.equal(isOutlineMode('green'), false);
  assert.equal(outlineColorHex('off'), null);
  assert.equal(outlineColorHex('yellow'), 0xffd84a);
  assert.ok(OUTLINE_SCALE > 1 && OUTLINE_SCALE < 1.2);
});

test('SPEC 37.5: everybody is an enemy in DM; only the other team in TDM', () => {
  assert.equal(isEnemyOf(-1, -1), true);
  assert.equal(isEnemyOf(0, 0), false);
  assert.equal(isEnemyOf(1, 0), true);
  assert.equal(isEnemyOf(0, 1), true);
});

test('SPEC 37.3 / 37.5: the new preferences exist with their documented defaults', () => {
  const d = prefDefaults();
  assert.equal(d.enemyOutline, 'off');
  assert.deepEqual(PREFS.enemyOutline.values, ['off', 'yellow', 'red', 'purple']);
  assert.equal(PREFS.enemyOutline.tab, 'video');
  assert.equal(d.minimapFootsteps, true);
  assert.equal(d.minimapCone, true);
});
