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
  ],
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
  ],
});

export const MAPS = Object.freeze({
  arena: Object.freeze({ id: 'arena', name: 'Arena', ...MAP }),
  foundry: FOUNDRY,
  crossfire: CROSSFIRE,
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
export const describeMap = (m) => ({ id: m.id, name: m.name, half: m.half, boxes: m.boxes });
