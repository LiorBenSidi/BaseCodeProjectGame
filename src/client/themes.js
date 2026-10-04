// Per map visual themes (SPEC 30.1, D-027). Pure numbers: scene.js turns them into lights, fog, sky and
// materials; textures.js turns the surface recipes into procedural tiles. docs/ART_DIRECTION.md is the prose.
// Team colors and silhouettes (arenaStyle.js) stay above every theme: themes never use the team hues.

export const THEMES = Object.freeze({
  // Arena: clean industrial, dusk. Concrete floor, slate metal cover.
  arena: Object.freeze({
    id: 'arena',
    sky: { zenith: 0x070a16, horizon: 0x1a2440, sun: 0xffd9a8, sunDir: [0.5, 0.75, 0.3] },
    fog: { color: 0x121a2e, near: 35, far: 150 },
    sun: { color: 0xffe3c2, intensity: 2.0, position: [28, 46, 18] },
    hemi: { sky: 0x9db1dc, ground: 0x2a3140, intensity: 0.9 },
    fill: { color: 0x8fa6ff, intensity: 0.6, position: [-24, 20, -30] },
    exposure: 1.1,
    floor: { surface: 'concrete', color: 0x4b5563, tile: 4 },
    wall: { surface: 'concrete', color: 0x3f4756, tile: 4 },
    cover: { surface: 'metal', color: 0x5b6b80, tile: 2 },
    accent: 0x7aa2ff, // lamps and trim
    grid: { opacity: 0.16 },
  }),
  // Foundry: rusted steel, oxidised copper, hot orange light from below the decks.
  foundry: Object.freeze({
    id: 'foundry',
    sky: { zenith: 0x0a0604, horizon: 0x3a1d10, sun: 0xffb070, sunDir: [-0.4, 0.5, 0.6] },
    fog: { color: 0x2a1812, near: 25, far: 120 },
    sun: { color: 0xffc090, intensity: 1.6, position: [-22, 40, 30] },
    hemi: { sky: 0x8a6a50, ground: 0x3a1a10, intensity: 0.8 },
    fill: { color: 0xff7a30, intensity: 0.9, position: [20, 6, -20] },
    exposure: 1.05,
    floor: { surface: 'metal', color: 0x4a3b33, tile: 3 },
    wall: { surface: 'rust', color: 0x5a3a2a, tile: 4 },
    cover: { surface: 'rust', color: 0x6b4a36, tile: 2 },
    accent: 0xff8a3d,
    grid: { opacity: 0.08 },
  }),
  // Crossfire: desert sandstone and weathered masonry under a hard noon sun.
  crossfire: Object.freeze({
    id: 'crossfire',
    sky: { zenith: 0x2a5fb0, horizon: 0xd8c3a0, sun: 0xfff4dc, sunDir: [0.3, 0.9, -0.2] },
    fog: { color: 0xcbb79a, near: 45, far: 190 },
    sun: { color: 0xfff1d6, intensity: 2.6, position: [20, 60, -14] },
    hemi: { sky: 0xa9c4ef, ground: 0x8c7355, intensity: 1.0 },
    fill: { color: 0xffe0b0, intensity: 0.4, position: [-30, 18, 24] },
    exposure: 1.0,
    floor: { surface: 'sand', color: 0xc2a67c, tile: 5 },
    wall: { surface: 'masonry', color: 0xb08a5e, tile: 3 },
    cover: { surface: 'masonry', color: 0xa67f56, tile: 2 },
    accent: 0xffd27a,
    grid: { opacity: 0.0 },
  }),
});

export const DEFAULT_THEME = THEMES.arena;

export function themeFor(mapId) {
  return THEMES[mapId] ?? DEFAULT_THEME;
}

// The four perimeter walls are the first four boxes of every map (maps.js perimeter()); taller than 4 m
// boxes count as walls too. Everything else is cover.
export function surfaceKindFor(box, index) {
  const h = box.max[1] - box.min[1];
  return index < 4 || h >= 5 ? 'wall' : 'cover';
}

// UV repeat so a texture tile covers `tile` metres on each axis, whatever the box size.
export function tileRepeat(width, height, tile) {
  return [Math.max(1, Math.round((width / tile) * 2) / 2), Math.max(1, Math.round((height / tile) * 2) / 2)];
}

// Quality tiers (SPEC 30.5). Pure: the caller passes what it knows about the device.
export const QUALITY = Object.freeze(['low', 'medium', 'high']);

export function qualityTierFor({ isTouch = false, dpr = 1, width = 1920, height = 1080, cores = 4, memoryGb = 8 } = {}) {
  if (isTouch || cores <= 2 || memoryGb <= 2 || height <= 500) return 'low';
  if (width * height * Math.min(dpr, 2) > 2560 * 1440 || cores <= 4 || memoryGb <= 4) return 'medium';
  return 'high';
}

export const QUALITY_SETTINGS = Object.freeze({
  low: Object.freeze({ shadows: false, shadowMap: 1024, bloom: false, fxaa: true, maxPixelRatio: 1, textureSize: 256, props: true }),
  medium: Object.freeze({ shadows: true, shadowMap: 1024, bloom: true, fxaa: true, maxPixelRatio: 1.5, textureSize: 512, props: true }),
  high: Object.freeze({ shadows: true, shadowMap: 2048, bloom: true, fxaa: true, maxPixelRatio: 2, textureSize: 512, props: true }),
});
