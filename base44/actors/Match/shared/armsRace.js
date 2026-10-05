// Arms Race: a team mode with weapon stages (SPEC 40.3, D-039). Pure: the room owns the clock and the players.
// Every team starts on the first stage. Three kills by a team advance it to the next weapon; three kills on the
// final weapon win the match. Kills never score anything else here: the stage ladder is the score.
import { WEAPONS } from './weapons.js';
import { TEAM_NAMES } from './modes.js';

export const STAGES = Object.freeze(['pistol', 'smg', 'shotgun', 'rifle', 'burst_rifle', 'lmg', 'sniper', 'revolver']);
export const ARMS_KILLS_PER_STAGE = 3;
export const FINAL_STAGE = STAGES.length - 1;
export const ARMS_TOTAL_KILLS = STAGES.length * ARMS_KILLS_PER_STAGE; // 24 kills from the first pistol kill to the win

export const newArms = () => ({ stages: [0, 0], progress: [0, 0], won: -1 });

export const stageWeapon = (arms, team) => STAGES[arms.stages[team]];
export const stageName = (stage) => WEAPONS[STAGES[stage]].name;

// The loadout a player of `team` carries: the stage weapon in both hands, so swapping slots never finds a hole.
export function armsLoadoutIds(arms, team) {
  const w = stageWeapon(arms, team);
  return { primary: w, sidearm: w };
}

// One enemy kill by `team`. Returns what changed so the room can re-arm and announce.
// A kill on a team that already won, or by an unknown team, changes nothing.
export function armsKill(arms, team) {
  if (arms.won >= 0 || !(team === 0 || team === 1)) return { advanced: false, won: false, stage: arms.stages[team] ?? 0, progress: arms.progress[team] ?? 0 };
  arms.progress[team] += 1;
  if (arms.progress[team] < ARMS_KILLS_PER_STAGE) return { advanced: false, won: false, stage: arms.stages[team], progress: arms.progress[team] };
  if (arms.stages[team] >= FINAL_STAGE) {
    arms.won = team;
    return { advanced: false, won: true, stage: arms.stages[team], progress: arms.progress[team] };
  }
  arms.stages[team] += 1;
  arms.progress[team] = 0;
  return { advanced: true, won: false, stage: arms.stages[team], progress: 0, weapon: stageWeapon(arms, team) };
}

// Who leads when time runs out: higher stage, then more kills on the stage, then more total kills; -1 for a draw.
export function armsLeader(arms, teamKills = [0, 0]) {
  if (arms.won >= 0) return arms.won;
  const cmp = (arms.stages[0] - arms.stages[1]) || (arms.progress[0] - arms.progress[1]) || ((teamKills[0] | 0) - (teamKills[1] | 0));
  return cmp === 0 ? -1 : cmp > 0 ? 0 : 1;
}

export const armsSnapshot = (arms) => ({ stages: [...arms.stages], progress: [...arms.progress] });

// Announcement texts. The team's own line names the weapon; the enemy line is short because it interrupts play.
export const stageText = (team, stage) => `${TEAM_NAMES[team].toUpperCase()} ADVANCES: ${stageName(stage).toUpperCase()}`;
export const ownStageBanner = (stage) => `STAGE ${stage + 1}: ${stageName(stage).toUpperCase()}`;
export const ENEMY_STAGE_BANNER = 'ENEMY ADVANCES';

// HUD line under the score, from the local player's team: 'STAGE 4/8  LMG  3/3   enemy 3/8'.
export function armsLine(arms, myTeam = -1) {
  if (!arms) return '';
  const mine = myTeam === 1 ? 1 : 0;
  const theirs = 1 - mine;
  const total = STAGES.length;
  const kills = `${arms.progress[mine]}/${ARMS_KILLS_PER_STAGE}`;
  return `STAGE ${arms.stages[mine] + 1}/${total}  ${stageName(arms.stages[mine]).toUpperCase()}  ${kills}   enemy ${arms.stages[theirs] + 1}/${total}`;
}
