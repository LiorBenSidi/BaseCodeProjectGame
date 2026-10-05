// SPEC 37.5: enemy outline as an inverted hull (D-036). A second back-face mesh scaled up a little around every
// body part, in a flat unlit colour, reads as a silhouette line at any distance and costs no extra render pass.
export const OUTLINE_MODES = Object.freeze(['off', 'yellow', 'red', 'purple']);
export const OUTLINE_COLORS = Object.freeze({ yellow: 0xffd84a, red: 0xff4a4a, purple: 0xc462ff });
export const OUTLINE_SCALE = 1.08; // hull scale around each box, about a 1 px line at 20 m on a 1080p view

export const isOutlineMode = (m) => OUTLINE_MODES.includes(m);
export const outlineColorHex = (mode) => OUTLINE_COLORS[mode] ?? null;

// An enemy is anybody on another team in TDM; in DM (team -1) everybody else is an enemy.
export function isEnemyOf(team, selfTeam) {
  if (selfTeam < 0 || team < 0) return true;
  return team !== selfTeam;
}
