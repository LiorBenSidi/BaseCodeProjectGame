// Procedural PBR tiles (SPEC 30.2). No downloaded assets: every surface is generated on a canvas at load from a
// seeded value noise, so the game ships with zero licensing surface and works offline. The pure part
// (`valueNoise`, `surfaceRecipe`, `samplePixel`) is tested; `makeSurfaceTextures` needs a DOM canvas.
import * as THREE from 'three';

// Deterministic hash noise in [0, 1): same (x, y, seed) gives the same value on every device.
export function hash2(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Tiling value noise over a `period` grid, smooth interpolation.
export function valueNoise(x, y, period, seed = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const wrap = (v) => ((v % period) + period) % period;
  const n = (ix, iy) => hash2(wrap(ix), wrap(iy), seed);
  const a = n(x0, y0), b = n(x0 + 1, y0), c = n(x0, y0 + 1), d = n(x0 + 1, y0 + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

// Octaves of tiling noise, normalised to about [0, 1].
export function fbm(x, y, period, seed, octaves = 4) {
  let sum = 0, amp = 0.5, total = 0, p = period, fx = x, fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(fx, fy, p, seed + o) * amp;
    total += amp;
    amp *= 0.5; p *= 2; fx *= 2; fy *= 2;
  }
  return sum / total;
}

// How each surface family is built. `base` is the material color (a theme tints it), the recipe only shapes
// grain, plates and mortar lines. Roughness is written to its own map so metal reads as metal.
export const SURFACES = Object.freeze({
  concrete: { grain: 0.18, octaves: 5, plates: 0, mortar: 0, roughness: [0.82, 0.96], metalness: 0.02, speckle: 0.06 },
  metal: { grain: 0.08, octaves: 3, plates: 2, mortar: 0.03, roughness: [0.35, 0.6], metalness: 0.65, speckle: 0.03 },
  rust: { grain: 0.3, octaves: 5, plates: 2, mortar: 0.025, roughness: [0.7, 0.95], metalness: 0.25, speckle: 0.1 },
  sand: { grain: 0.14, octaves: 4, plates: 0, mortar: 0, roughness: [0.9, 1.0], metalness: 0.0, speckle: 0.05 },
  masonry: { grain: 0.16, octaves: 4, plates: 4, mortar: 0.06, roughness: [0.75, 0.95], metalness: 0.0, speckle: 0.04 },
});

export function surfaceRecipe(name) {
  return SURFACES[name] ?? SURFACES.concrete;
}

// One texel of a tile: returns { shade (0..1 multiplier on the base color), rough (0..1) }.
export function samplePixel(recipe, u, v, seed) {
  const grain = fbm(u * 8, v * 8, 8, seed, recipe.octaves);
  let shade = 1 + (grain - 0.5) * 2 * recipe.grain;
  let rough = recipe.roughness[0] + (recipe.roughness[1] - recipe.roughness[0]) * grain;
  if (recipe.plates > 0) {
    // plate or brick grid with a dark mortar line; bricks offset every other row
    const row = Math.floor(v * recipe.plates);
    const offset = recipe.plates > 2 && row % 2 === 1 ? 0.5 / recipe.plates : 0;
    const gu = ((u + offset) * recipe.plates) % 1;
    const gv = (v * recipe.plates) % 1;
    const m = recipe.mortar * recipe.plates;
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    if (edge < m) { shade *= 0.62 + 0.3 * (edge / m); rough = Math.min(1, rough + 0.1); }
    else shade *= 1 + (hash2(Math.floor((u + offset) * recipe.plates), row, seed + 99) - 0.5) * 0.12; // per plate tone
  }
  const spk = hash2(Math.floor(u * 512), Math.floor(v * 512), seed + 7);
  if (spk < recipe.speckle) shade *= 0.8;
  return { shade: Math.max(0.3, Math.min(1.4, shade)), rough: Math.max(0, Math.min(1, rough)) };
}

// Builds { map, roughnessMap } canvas textures of `size` px for a surface. Cached per (surface, size).
const cache = new Map();
export function makeSurfaceTextures(name, size = 512, seed = 1) {
  const key = `${name}:${size}`;
  if (cache.has(key)) return cache.get(key);
  if (typeof document === 'undefined') return null;
  const recipe = surfaceRecipe(name);
  const albedo = document.createElement('canvas');
  const rough = document.createElement('canvas');
  albedo.width = albedo.height = rough.width = rough.height = size;
  const a = albedo.getContext('2d'), r = rough.getContext('2d');
  const ai = a.createImageData(size, size), ri = r.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = samplePixel(recipe, x / size, y / size, seed);
      const i = (y * size + x) * 4;
      const g = Math.round(255 * Math.min(1, px.shade * 0.7)); // mid grey tile; the material color tints it
      ai.data[i] = ai.data[i + 1] = ai.data[i + 2] = g; ai.data[i + 3] = 255;
      const rg = Math.round(255 * px.rough);
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rg; ri.data[i + 3] = 255;
    }
  }
  a.putImageData(ai, 0, 0); r.putImageData(ri, 0, 0);
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const t of [map, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  const out = { map, roughnessMap, metalness: recipe.metalness };
  cache.set(key, out);
  return out;
}

// A material for a surface, tinted by the theme color; clones the shared textures so each mesh can set its repeat.
export function surfaceMaterial(name, color, repeat, size = 512) {
  const tex = makeSurfaceTextures(name, size);
  if (!tex) return new THREE.MeshStandardMaterial({ color, roughness: surfaceRecipe(name).roughness[1], metalness: surfaceRecipe(name).metalness });
  const map = tex.map.clone(); map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true;
  const roughnessMap = tex.roughnessMap.clone(); roughnessMap.repeat.set(repeat[0], repeat[1]); roughnessMap.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color, map, roughnessMap, roughness: 1, metalness: tex.metalness });
}
