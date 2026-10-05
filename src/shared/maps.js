// Map registry and rotation (docs/SPEC.md section 28, D-025). Pure. Every map has the same shape as
// map.js MAP: { id, name, half, boxes, spawns, pickups }. The server picks a map per match (rotation by
// match number), tells the client in `welcome` and `matchStart`, and the client rebuilds the arena.
import { MAP } from './map.js';

const box = (cx, cz, w, d, h, y0 = 0) => ({ min: [cx - w / 2, y0, cz - d / 2], max: [cx + w / 2, y0 + h, cz + d / 2] });

function perimeter(half, wall = 1, height = 6) {
  return [
    box(0, -half - wall / 2, half * 2 + wall * 2, wall, height),
    box(0, half + wall / 2, half * 2 + wall * 2, wall, height),
    box(-half - wall / 2, 0, wall, half * 2, height),
    box(half + wall / 2, 0, wall, half * 2, height),
  ];
}

// Foundry: two raised decks joined by a bridge over a sunken lane; tight corners, long bridge sightline.
const FOUNDRY_HALF = 36;
const FOUNDRY = Object.freeze({
  id: 'foundry',
  name: 'Foundry',
  half: FOUNDRY_HALF,
  boxes: [
    ...perimeter(FOUNDRY_HALF),
    box(-22, 0, 12, 14, 2.5), // west deck
    box(22, 0, 12, 14, 2.5), // east deck
    box(0, 0, 32, 3, 2.5), // bridge
    box(-14, 0, 4, 3, 1.25), box(14, 0, 4, 3, 1.25), // steps onto the bridge
    box(0, -14, 10, 1, 2.5), box(0, 14, 10, 1, 2.5), // lane cover
    box(-8, -24, 1, 8, 3), box(8, 24, 1, 8, 3), // corner walls
    box(-28, -26, 3, 3, 3), box(28, 26, 3, 3, 3), box(28, -26, 3, 3, 3), box(-28, 26, 3, 3, 3), // pillars
    box(0, -30, 6, 2, 1.25), box(0, 30, 6, 2, 1.25), // low lane blocks
  ],
  spawns: [
    { x: -30, z: -30, yaw: -Math.PI * 0.75 }, { x: 30, z: -30, yaw: Math.PI * 0.75 },
    { x: -30, z: 30, yaw: -Math.PI * 0.25 }, { x: 30, z: 30, yaw: Math.PI * 0.25 },
    { x: -22, z: -12, yaw: 0 }, { x: 22, z: 12, yaw: Math.PI },
    { x: 0, z: -32, yaw: Math.PI }, { x: 0, z: 32, yaw: 0 },
  ],
  pickups: [
    { type: 'sniper', x: 0, y: 2.5, z: 0 },
    { type: 'health', x: -22, y: 2.5, z: 0 }, { type: 'health', x: 22, y: 2.5, z: 0 },
    { type: 'ammo', x: 0, z: -20 }, { type: 'ammo', x: 0, z: 20 },
    { type: 'smg', x: -28, z: 30 }, { type: 'shotgun', x: 28, z: -30 },
    { type: 'ammo', x: -28, z: -30 }, { type: 'health', x: 28, z: 30 },
    { type: 'lmg', x: 0, z: 34 }, { type: 'revolver', x: 0, z: -34 }, // SPEC 38.1
  ],
  hills: [{ x: 0, z: -22 }, { x: 0, z: 22 }, { x: -22, z: 10 }], // SPEC 39: lanes and the west deck foot, all on the floor
  bases: [{ x: -30, z: -30 }, { x: 30, z: 30 }],
});

// Crossfire: a plus-shaped set of walls splitting the arena into four rooms around an open hub.
const CROSS_HALF = 40;
const CROSSFIRE = Object.freeze({
  id: 'crossfire',
  name: 'Crossfire',
  half: CROSS_HALF,
  boxes: [
    ...perimeter(CROSS_HALF),
    box(0, -22, 1, 24, 4), box(0, 22, 1, 24, 4), box(-22, 0, 24, 1, 4), box(22, 0, 24, 1, 4), // the cross, open hub in the middle (10 m gaps)
    box(0, 0, 6, 6, 1.25), // hub plinth
    box(-20, -20, 4, 4, 3), box(20, 20, 4, 4, 3), box(20, -20, 4, 4, 3), box(-20, 20, 4, 4, 3), // room pillars
    box(-30, -12, 6, 1, 2.5), box(30, 12, 6, 1, 2.5), box(-12, 30, 1, 6, 2.5), box(12, -30, 1, 6, 2.5), // room cover
    box(-34, -34, 4, 4, 1.25), box(34, 34, 4, 4, 1.25), box(34, -34, 4, 4, 1.25), box(-34, 34, 4, 4, 1.25), // corner ledges
  ],
  spawns: [
    { x: -32, z: -32, yaw: -Math.PI * 0.75 }, { x: 32, z: -32, yaw: Math.PI * 0.75 },
    { x: -32, z: 32, yaw: -Math.PI * 0.25 }, { x: 32, z: 32, yaw: Math.PI * 0.25 },
    { x: -14, z: -34, yaw: Math.PI }, { x: 14, z: 34, yaw: 0 },
    { x: -34, z: 14, yaw: -Math.PI / 2 }, { x: 34, z: -14, yaw: Math.PI / 2 },
  ],
  pickups: [
    { type: 'sniper', x: 0, y: 1.25, z: 0 },
    { type: 'health', x: -20, z: -14 }, { type: 'health', x: 20, z: 14 },
    { type: 'ammo', x: -14, z: 20 }, { type: 'ammo', x: 14, z: -20 },
    { type: 'smg', x: -34, z: -26 }, { type: 'shotgun', x: 34, z: 26 },
    { type: 'ammo', x: 34, z: -26 }, { type: 'health', x: -34, z: 26 },
    { type: 'burst_rifle', x: -26, z: 26 }, { type: 'revolver', x: 0, z: 34 }, // SPEC 38.1
  ],
  hills: [{ x: 0, z: 10 }, { x: -20, z: -8 }, { x: 20, z: 8 }], // SPEC 39: hub edge and two rooms
  bases: [{ x: -32, z: -32 }, { x: 32, z: 32 }],
});

// SPEC 39 (D-038): Summit, a terraced plateau. A raised centre with ramps on four sides (1.25 m steps a player
// walks up), two long flanking galleries and low cover rings; built for KOTH: the hill rotates between the summit
// and the two galleries.
const SUMMIT_HALF = 40;
const SUMMIT = Object.freeze({
  id: 'summit',
  name: 'Summit',
  half: SUMMIT_HALF,
  boxes: [
    ...perimeter(SUMMIT_HALF),
    box(0, 0, 14, 14, 1.25), // summit plateau (one step up: walkable)
    box(-11, 0, 8, 6, 1.25), box(11, 0, 8, 6, 1.25), // side plateaus (same height, same step)
    box(0, -24, 20, 1, 3), box(0, 24, 20, 1, 3), // gallery back walls
    box(-14, -24, 1, 8, 3), box(14, -24, 1, 8, 3), box(-14, 24, 1, 8, 3), box(14, 24, 1, 8, 3), // gallery ends
    box(-28, -12, 3, 3, 3), box(28, 12, 3, 3, 3), box(28, -12, 3, 3, 3), box(-28, 12, 3, 3, 3), // pillars
    box(-30, 0, 1, 10, 2.5), box(30, 0, 1, 10, 2.5), // flank walls
    box(-20, -34, 6, 2, 1.25), box(20, 34, 6, 2, 1.25), box(20, -34, 6, 2, 1.25), box(-20, 34, 6, 2, 1.25), // corner cover
  ],
  spawns: [
    { x: -34, z: -34, yaw: -Math.PI * 0.75 }, { x: 34, z: -34, yaw: Math.PI * 0.75 },
    { x: -34, z: 34, yaw: -Math.PI * 0.25 }, { x: 34, z: 34, yaw: Math.PI * 0.25 },
    { x: 0, z: -36, yaw: Math.PI }, { x: 0, z: 36, yaw: 0 },
    { x: -36, z: 0, yaw: -Math.PI / 2 }, { x: 36, z: 0, yaw: Math.PI / 2 },
  ],
  pickups: [
    { type: 'sniper', x: 0, y: 1.25, z: 0 },
    { type: 'health', x: 0, z: -20 }, { type: 'health', x: 0, z: 20 },
    { type: 'ammo', x: -22, z: 0 }, { type: 'ammo', x: 22, z: 0 },
    { type: 'smg', x: -34, z: -20 }, { type: 'shotgun', x: 34, z: 20 },
    { type: 'lmg', x: 34, z: -20 }, { type: 'burst_rifle', x: -34, z: 20 },
    { type: 'revolver', x: 0, z: 30 },
  ],
  hills: [{ x: 0, z: 0 }, { x: 0, z: -20 }, { x: 0, z: 20 }], // the summit (1.25 m up, walkable), then each gallery
  bases: [{ x: -34, z: -34 }, { x: 34, z: 34 }],
});

// SPEC 39 (D-038): Canal, two shores split by a dry canal with three crossings. Built for CTF: each team's base
// sits on its shore; the carrier must cross at a bridge or run the canal bed in the open.
const CANAL_HALF = 44;
const CANAL = Object.freeze({
  id: 'canal',
  name: 'Canal',
  half: CANAL_HALF,
  boxes: [
    ...perimeter(CANAL_HALF),
    box(-7, 0, 1, 88, 1.25), box(7, 0, 1, 88, 1.25), // canal edges (low: a player steps over them, into the bed)
    box(0, -28, 14, 4, 1.25), box(0, 0, 14, 4, 1.25), box(0, 28, 14, 4, 1.25), // three bridges across the canal
    box(-24, -14, 10, 1, 3), box(24, 14, 10, 1, 3), box(-24, 14, 10, 1, 3), box(24, -14, 10, 1, 3), // shore walls
    box(-16, -34, 1, 8, 3), box(16, 34, 1, 8, 3), box(16, -34, 1, 8, 3), box(-16, 34, 1, 8, 3), // approach walls
    box(-36, 0, 4, 4, 3), box(36, 0, 4, 4, 3), // shore pillars
    box(-30, -30, 3, 3, 1.25), box(30, 30, 3, 3, 1.25), box(30, -30, 3, 3, 1.25), box(-30, 30, 3, 3, 1.25), // ledges
  ],
  spawns: [
    { x: -38, z: -38, yaw: -Math.PI * 0.75 }, { x: -38, z: 38, yaw: -Math.PI * 0.25 }, { x: -38, z: 0, yaw: -Math.PI / 2 }, { x: -26, z: -26, yaw: -Math.PI / 2 },
    { x: 38, z: 38, yaw: Math.PI * 0.25 }, { x: 38, z: -38, yaw: Math.PI * 0.75 }, { x: 38, z: 0, yaw: Math.PI / 2 }, { x: 26, z: 26, yaw: Math.PI / 2 },
  ],
  pickups: [
    { type: 'sniper', x: 0, y: 1.25, z: 0 },
    { type: 'health', x: 0, z: -14 }, { type: 'health', x: 0, z: 14 },
    { type: 'ammo', x: -20, z: 0 }, { type: 'ammo', x: 20, z: 0 },
    { type: 'smg', x: -30, z: -20 }, { type: 'shotgun', x: 30, z: 20 },
    { type: 'lmg', x: 30, z: -20 }, { type: 'burst_rifle', x: -30, z: 20 },
    { type: 'revolver', x: 0, z: -40 },
  ],
  hills: [{ x: 0, z: 0 }, { x: 0, z: -28 }, { x: 0, z: 28 }], // the three bridges
  bases: [{ x: -38, z: 0 }, { x: 38, z: 0 }],
});

export const MAPS = Object.freeze({
  arena: Object.freeze({ id: 'arena', name: 'Arena', ...MAP }),
  foundry: FOUNDRY,
  crossfire: CROSSFIRE,
  summit: SUMMIT, // SPEC 39
  canal: CANAL,
});
export const MAP_IDS = Object.freeze(Object.keys(MAPS));
export const DEFAULT_MAP = 'arena';

export function mapDef(id) {
  const m = MAPS[id];
  if (!m) throw new RangeError(`unknown map: ${id}`);
  return m;
}

export const isMap = (id) => typeof id === 'string' && Object.hasOwn(MAPS, id);

// Match 1 plays the default map, then the rotation continues in registry order.
export const mapForMatch = (number) => MAP_IDS[((Math.max(1, number | 0) - 1) % MAP_IDS.length)];

// Compact description for welcome / matchStart.
export const describeMap = (m) => ({ id: m.id, name: m.name, half: m.half, boxes: m.boxes, hills: m.hills ?? [], bases: m.bases ?? [] }); // SPEC 39: objectives travel with the map
