// Visual props per map (SPEC 30.4, D-027). Pure and deterministic: derived from the map's collision boxes so a
// new map gets dressing for free and the props never need their own collision. Two placement rules keep them
// honest: crates sit on top of cover at least 2 m high (a player cannot stand inside them because the top is
// where the player stands, and they are small enough to leave the walkable top usable), lamps hang on the
// inner face of the perimeter walls at 3.5 m, above head height. Nothing is placed on the floor.
const CRATE_MIN_TOP = 2;
const CRATE_MIN_FOOT = 3;
const LAMP_SPACING = 16;
const LAMP_HEIGHT = 3.5;

const hash = (a, b) => {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h >>> 0) % 1000) / 1000;
};

export function propsFor(map) {
  const out = [];
  if (!map || !Array.isArray(map.boxes)) return out;
  const half = map.half;
  const perimeter = map.boxes.slice(0, 4);
  // lamps on the four walls, facing inward
  for (let w = 0; w < perimeter.length; w++) {
    const b = perimeter[w];
    const alongX = b.max[0] - b.min[0] > b.max[2] - b.min[2];
    const inner = w === 0 ? -half : w === 1 ? half : w === 2 ? -half : half; // wall order: north, south, west, east
    const n = Math.max(1, Math.floor((half * 2) / LAMP_SPACING));
    for (let i = 0; i < n; i++) {
      const t = -half + (half * 2) * ((i + 0.5) / n);
      if (alongX) out.push({ kind: 'lamp', x: t, y: LAMP_HEIGHT, z: inner, ry: inner < 0 ? 0 : Math.PI });
      else out.push({ kind: 'lamp', x: inner, y: LAMP_HEIGHT, z: t, ry: inner < 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  // crates on tall cover
  for (let i = 4; i < map.boxes.length; i++) {
    const b = map.boxes[i];
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], top = b.max[1];
    if (top < CRATE_MIN_TOP || w < CRATE_MIN_FOOT || d < CRATE_MIN_FOOT || top >= 5) continue;
    const r = hash(i, 1);
    const cx = b.min[0] + w * (0.25 + 0.5 * r);
    const cz = b.min[2] + d * (0.25 + 0.5 * hash(i, 2));
    const s = 0.6 + 0.3 * hash(i, 3);
    if (map.spawns?.some((sp) => Math.hypot(sp.x - cx, sp.z - cz) < 1.5)) continue;
    out.push({ kind: r > 0.5 ? 'crate' : 'barrel', x: cx, y: top, z: cz, ry: hash(i, 4) * Math.PI, s });
  }
  // trim along the top edge of the perimeter walls, one piece per wall
  for (let w = 0; w < perimeter.length; w++) {
    const b = perimeter[w];
    out.push({ kind: 'trim', x: (b.min[0] + b.max[0]) / 2, y: b.max[1], z: (b.min[2] + b.max[2]) / 2, sx: b.max[0] - b.min[0], sz: b.max[2] - b.min[2] });
  }
  return out;
}

// Sanity used by tests and the scene: a prop must sit inside the arena and never at floor level.
export function propIsValid(p, map) {
  if (!p || typeof p.x !== 'number' || typeof p.z !== 'number' || typeof p.y !== 'number') return false;
  if (Math.abs(p.x) > map.half + 1 || Math.abs(p.z) > map.half + 1) return false;
  return p.y >= CRATE_MIN_TOP;
}
