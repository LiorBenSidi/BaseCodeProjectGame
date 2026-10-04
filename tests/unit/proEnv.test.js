// SPEC 30 (D-027): themes, procedural texture recipes, props placement and quality tiers. Pure parts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, themeFor, DEFAULT_THEME, surfaceKindFor, tileRepeat, qualityTierFor, QUALITY_SETTINGS, QUALITY } from '../../src/client/themes.js';
import { hash2, valueNoise, fbm, SURFACES, surfaceRecipe, samplePixel } from '../../src/client/textures.js';
import { propsFor, propIsValid } from '../../src/shared/props.js';
import { MAPS } from '../../src/shared/maps.js';
import { MAP } from '../../src/shared/map.js';
import { PALETTE } from '../../src/client/theme.js';
import { getQuality, setQuality, KEYS } from '../../src/client/settings.js';

const allMaps = Object.values(MAPS); // map.js MAP has no id and resolves to the arena theme

test('every map has a theme, unknown maps fall back to arena, themes never borrow the team colors', () => {
  for (const m of allMaps) assert.equal(themeFor(m.id).id, m.id, `theme for ${m.id}`);
  assert.equal(themeFor('nope'), DEFAULT_THEME);
  for (const t of Object.values(THEMES)) {
    for (const s of ['floor', 'wall', 'cover']) {
      assert.ok(SURFACES[t[s].surface], `${t.id} ${s} surface exists`);
      assert.ok(t[s].tile >= 1 && t[s].tile <= 8);
      assert.notEqual(t[s].color, PALETTE.teamBlue);
      assert.notEqual(t[s].color, PALETTE.teamRed);
    }
    assert.ok(t.fog.near < t.fog.far);
    assert.ok(t.sun.intensity > 0 && t.exposure > 0.5 && t.exposure < 1.5);
  }
});

test('surface kinds: the perimeter and anything 5 m or taller are walls, the rest is cover; tiling follows world size', () => {
  const m = MAPS.foundry;
  for (let i = 0; i < 4; i++) assert.equal(surfaceKindFor(m.boxes[i], i), 'wall');
  assert.equal(surfaceKindFor({ min: [0, 0, 0], max: [4, 2.5, 4] }, 7), 'cover');
  assert.equal(surfaceKindFor({ min: [0, 0, 0], max: [1, 6, 10] }, 9), 'wall');
  assert.deepEqual(tileRepeat(8, 4, 4), [2, 1]);
  assert.deepEqual(tileRepeat(1, 1, 4), [1, 1], 'never below one tile');
  assert.deepEqual(tileRepeat(10, 2.5, 2), [5, 1.5], 'half tile steps');
});

test('noise is deterministic, tiles across its period and stays inside [0, 1]', () => {
  assert.equal(hash2(3, 4, 1), hash2(3, 4, 1));
  assert.notEqual(hash2(3, 4, 1), hash2(4, 3, 1));
  for (let i = 0; i < 200; i++) {
    const v = valueNoise(i * 0.37, i * 0.91, 8, 5);
    assert.ok(v >= 0 && v <= 1, `${v}`);
  }
  const a = valueNoise(1.25, 2.5, 8, 3), b = valueNoise(1.25 + 8, 2.5 - 16, 8, 3);
  assert.ok(Math.abs(a - b) < 1e-12, 'periodic');
  const f = fbm(0.3, 0.7, 8, 2);
  assert.ok(f >= 0 && f <= 1);
  assert.equal(surfaceRecipe('bogus'), SURFACES.concrete);
});

test('texels: concrete has no mortar lines, masonry darkens on its mortar grid, metal is rough in range and metallic', () => {
  const c = samplePixel(SURFACES.concrete, 0.5, 0.5, 1);
  assert.ok(c.shade > 0.5 && c.shade < 1.4 && c.rough >= 0.82 && c.rough <= 0.96);
  const onLine = samplePixel(SURFACES.masonry, 0.001, 0.5, 1); // first column of a brick: mortar
  const inside = samplePixel(SURFACES.masonry, 0.125, 0.125, 1);
  assert.ok(onLine.shade < inside.shade, `mortar ${onLine.shade} darker than brick ${inside.shade}`);
  const m = samplePixel(SURFACES.metal, 0.3, 0.3, 1);
  assert.ok(m.rough >= 0.35 && m.rough <= 0.7);
  assert.ok(SURFACES.metal.metalness > 0.5 && SURFACES.sand.metalness === 0);
  for (let i = 0; i < 500; i++) {
    const px = samplePixel(SURFACES.rust, (i * 0.013) % 1, (i * 0.029) % 1, 2);
    assert.ok(px.shade >= 0.3 && px.shade <= 1.4 && px.rough >= 0 && px.rough <= 1);
  }
});

test('props: every map gets lamps on its four walls and crates only on tall cover, never on the floor or on a spawn', () => {
  for (const m of allMaps) {
    const props = propsFor(m);
    assert.ok(props.length > 8, `${m.id} has props (${props.length})`);
    const lamps = props.filter((p) => p.kind === 'lamp');
    assert.ok(lamps.length >= 4, 'lamps');
    assert.equal(props.filter((p) => p.kind === 'trim').length, 4, 'one trim per wall');
    for (const p of props) {
      assert.ok(propIsValid(p, m), `${m.id} ${p.kind} at ${p.x},${p.y},${p.z}`);
      if (p.kind === 'crate' || p.kind === 'barrel') {
        const under = m.boxes.find((b, i) => i >= 4 && p.x >= b.min[0] && p.x <= b.max[0] && p.z >= b.min[2] && p.z <= b.max[2] && Math.abs(b.max[1] - p.y) < 1e-9);
        assert.ok(under, 'stands on the top of a cover box');
        assert.ok(under.max[1] >= 2 && under.max[1] < 5);
        for (const sp of m.spawns) assert.ok(Math.hypot(sp.x - p.x, sp.z - p.z) >= 1.5, 'clear of spawns');
      }
      if (p.kind === 'lamp') assert.ok(Math.abs(Math.abs(p.x) - m.half) < 1e-9 || Math.abs(Math.abs(p.z) - m.half) < 1e-9, 'on a wall face');
    }
    assert.deepEqual(propsFor(m), props, 'deterministic');
  }
  assert.deepEqual(propsFor(null), []);
  assert.equal(propIsValid({ x: 0, y: 0, z: 0 }, MAP), false, 'floor level is never valid');
});

test('quality tiers: touch and weak devices go low, big screens on mid hardware go medium, desktops go high; settings persist', () => {
  assert.equal(qualityTierFor({ isTouch: true }), 'low');
  assert.equal(qualityTierFor({ cores: 2 }), 'low');
  assert.equal(qualityTierFor({ height: 480 }), 'low');
  assert.equal(qualityTierFor({ width: 3840, height: 2160, dpr: 1, cores: 8, memoryGb: 8 }), 'medium');
  assert.equal(qualityTierFor({ cores: 4, memoryGb: 8 }), 'medium');
  assert.equal(qualityTierFor({ cores: 8, memoryGb: 8 }), 'high');
  assert.equal(qualityTierFor(), 'medium', 'defaults are conservative');
  for (const q of QUALITY) assert.ok(QUALITY_SETTINGS[q].maxPixelRatio >= 1 && QUALITY_SETTINGS[q].textureSize >= 256);
  assert.equal(QUALITY_SETTINGS.low.bloom, false);
  assert.equal(QUALITY_SETTINGS.low.shadows, false);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(getQuality(storage), null);
  setQuality(storage, 'high');
  assert.equal(getQuality(storage), 'high');
  assert.equal(store.get(KEYS.quality), 'high');
  setQuality(storage, 'bogus');
  assert.equal(getQuality(storage), null, 'unknown clears to automatic');
  store.set(KEYS.quality, 'ultra');
  assert.equal(getQuality(storage), null, 'corrupt value reads as automatic');
});
