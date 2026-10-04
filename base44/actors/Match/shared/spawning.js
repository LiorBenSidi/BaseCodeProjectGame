// Spawn selection (docs/SPEC.md section 21.2). Pure.

// Without living enemies the spawn is Math.floor(random() * n) (the Milestone 1 rule, every index reachable).
// With enemies, the spot whose nearest living enemy is farthest wins; ties fall back to random among the tied.
export function pickSpawn(spawns, enemies, random) {
  const n = spawns.length;
  const alive = enemies.filter((e) => e.alive);
  if (alive.length === 0) return spawns[Math.min(n - 1, Math.floor(random() * n))];
  let best = -Infinity;
  let tied = [];
  for (const s of spawns) {
    let nearest = Infinity;
    for (const e of alive) nearest = Math.min(nearest, Math.hypot(s.x - e.x, s.z - e.z));
    if (nearest > best + 1e-9) { best = nearest; tied = [s]; } else if (Math.abs(nearest - best) <= 1e-9) tied.push(s);
  }
  return tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))];
}
