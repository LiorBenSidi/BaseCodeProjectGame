// Pure helpers behind the arena visual pass (docs/SPEC.md section 19.3). scene.js and remote.js are
// Three.js glue over these; the numbers that decide the look are checked here without a GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY, FOG, SUN, boxMaterialParams, skyColorAt, teamColorHex, nameTagLayout, shadowMapSizeFor, NAME_TAG,
} from '../../src/client/arenaStyle.js';
import { PALETTE } from '../../src/client/theme.js';
import { MAP } from '../../src/shared/map.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

test('fog matches the sky horizon so the far wall fades into the sky', () => {
  assert.equal(FOG.color, SKY.horizon);
  assert.equal(FOG.color, 0x0f172a);
  assert.ok(SKY.zenith < SKY.horizon, 'zenith darker than the horizon');
  assert.ok(FOG.near < FOG.far);
  assert.ok(FOG.far >= MAP.half * 2, 'the fog must not swallow the arena itself');
});

test('skyColorAt blends horizon to zenith and clamps', () => {
  assert.deepEqual(skyColorAt(0), skyColorAt(-1), 'below the horizon stays the horizon color');
  assert.deepEqual(skyColorAt(1), skyColorAt(2), 'above the zenith stays the zenith color');
  const [r0, g0, b0] = skyColorAt(0);
  const [r1, g1, b1] = skyColorAt(1);
  assert.equal(hex(Math.round(r0 * 255) * 65536 + Math.round(g0 * 255) * 256 + Math.round(b0 * 255)), hex(SKY.horizon));
  assert.equal(hex(Math.round(r1 * 255) * 65536 + Math.round(g1 * 255) * 256 + Math.round(b1 * 255)), hex(SKY.zenith));
  const mid = skyColorAt(0.5);
  for (let i = 0; i < 3; i++) {
    assert.ok(mid[i] >= Math.min([r0, g0, b0][i], [r1, g1, b1][i]) - 1e-9);
    assert.ok(mid[i] <= Math.max([r0, g0, b0][i], [r1, g1, b1][i]) + 1e-9);
  }
});

test('boxMaterialParams varies roughness and metalness per box, inside physical ranges, deterministic', () => {
  const seen = new Set();
  for (let i = 0; i < MAP.boxes.length; i++) {
    const p = boxMaterialParams(i);
    assert.ok(p.roughness >= 0.4 && p.roughness <= 1, `roughness ${p.roughness}`);
    assert.ok(p.metalness >= 0 && p.metalness <= 0.3, `metalness ${p.metalness}`);
    assert.ok(p.color.h >= 0 && p.color.h <= 1 && p.color.s >= 0 && p.color.s <= 1 && p.color.l > 0.15 && p.color.l < 0.6);
    seen.add(`${p.roughness}/${p.metalness}`);
    assert.deepEqual(boxMaterialParams(i), p);
  }
  assert.ok(seen.size >= 3, 'at least three distinct surface finishes');
});

test('teamColorHex: even ids blue, odd ids red, from the theme palette', () => {
  assert.equal(teamColorHex(0), PALETTE.teamBlue);
  assert.equal(teamColorHex(2), PALETTE.teamBlue);
  assert.equal(teamColorHex(1), PALETTE.teamRed);
  assert.equal(teamColorHex(7), PALETTE.teamRed);
});

test('nameTagLayout: bounded text, canvas size from the text, world scale keeps the aspect', () => {
  const l = nameTagLayout('Ariella');
  assert.equal(l.text, 'Ariella');
  assert.equal(l.width % 2, 0);
  assert.equal(l.height, NAME_TAG.height);
  assert.ok(l.width > l.height);
  assert.ok(Math.abs(l.scale[0] / l.scale[1] - l.width / l.height) < 1e-9, 'sprite scale keeps the canvas aspect');
  assert.equal(l.scale[1], NAME_TAG.worldHeight);
  const long = nameTagLayout('x'.repeat(40));
  assert.equal(long.text.length, 16, 'names are capped like sanitizeName does');
  assert.ok(long.width > l.width);
  assert.equal(nameTagLayout('').text, '?');
  assert.equal(nameTagLayout(null).text, '?');
});

test('shadowMapSizeFor: full size on desktop, half on short landscape (phone) viewports', () => {
  assert.equal(shadowMapSizeFor(1920, 1080), 2048);
  assert.equal(shadowMapSizeFor(844, 390), 1024);
  assert.equal(shadowMapSizeFor(1280, 500), 1024);
});

test('sun covers the whole arena with its shadow camera', () => {
  assert.ok(SUN.shadowExtent >= MAP.half + 2, 'walls sit just outside half');
  assert.ok(SUN.position[1] > 0);
});
