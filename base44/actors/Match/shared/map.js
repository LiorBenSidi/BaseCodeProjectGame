// Static arena. Boxes are axis-aligned: { min: [x, y, z], max: [x, y, z] }.
// The client renders them, the server collides and ray-casts against them.

const HALF = 40;

// Build a box from footprint centre (cx, cz), size (w, d), height h, and bottom y0.
function box(cx, cz, w, d, h, y0 = 0) {
  return { min: [cx - w / 2, y0, cz - d / 2], max: [cx + w / 2, y0 + h, cz + d / 2] };
}

const WALL = 1;
const WALL_H = 6;

export const MAP = {
  half: HALF,
  boxes: [
    // perimeter walls
    box(0, -HALF - WALL / 2, HALF * 2 + WALL * 2, WALL, WALL_H),
    box(0, HALF + WALL / 2, HALF * 2 + WALL * 2, WALL, WALL_H),
    box(-HALF - WALL / 2, 0, WALL, HALF * 2, WALL_H),
    box(HALF + WALL / 2, 0, WALL, HALF * 2, WALL_H),
    // central platform with steps
    box(0, 0, 10, 10, 2),
    box(0, 6.5, 4, 3, 1),
    box(0, -6.5, 4, 3, 1),
    // cover
    box(-15, -10, 6, 1, 2.5),
    box(15, 10, 6, 1, 2.5),
    box(-15, 12, 1, 6, 2.5),
    box(15, -12, 1, 6, 2.5),
    box(-26, 0, 3, 3, 3),
    box(26, 0, 3, 3, 3),
    box(0, -26, 8, 2, 2),
    box(0, 26, 8, 2, 2),
  ],
  spawns: [
    { x: -32, z: -32, yaw: -Math.PI * 0.75 },
    { x: 32, z: -32, yaw: Math.PI * 0.75 },
    { x: -32, z: 32, yaw: -Math.PI * 0.25 },
    { x: 32, z: 32, yaw: Math.PI * 0.25 },
    { x: 0, z: -34, yaw: Math.PI },
    { x: 0, z: 34, yaw: 0 },
    { x: -34, z: 0, yaw: -Math.PI / 2 },
    { x: 34, z: 0, yaw: Math.PI / 2 },
  ],
};
