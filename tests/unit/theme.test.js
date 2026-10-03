import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, SPACING, generateCssVariables } from '../../src/client/theme.js';

test('PALETTE: defines required color tokens as hex or functional color strings', () => {
  assert.ok(typeof PALETTE.bg === 'string');
  assert.ok(typeof PALETTE.surface === 'string');
  assert.ok(typeof PALETTE.accent === 'string');
  assert.ok(typeof PALETTE.teamBlue === 'string');
  assert.ok(typeof PALETTE.teamRed === 'string');
});

test('SPACING: defines consistent spacing tokens', () => {
  assert.ok(typeof SPACING.xs === 'string');
  assert.ok(typeof SPACING.sm === 'string');
  assert.ok(typeof SPACING.md === 'string');
  assert.ok(typeof SPACING.lg === 'string');
});

test('generateCssVariables: produces valid CSS custom properties block', () => {
  const css = generateCssVariables();
  assert.ok(css.includes(':root {'));
  assert.ok(css.includes('--bg:'));
  assert.ok(css.includes('--accent:'));
  assert.ok(css.includes('--team-blue:'));
  assert.ok(css.includes('--team-red:'));
  assert.ok(css.includes('}'));
});
