// Chat and streak announcements (docs/SPEC.md section 29, D-026). Pure.

export const CHAT_MAX_CHARS = 120;
export const CHAT_MIN_INTERVAL_MS = 1000; // per player; faster messages are dropped, not punished
export const CHAT_KEEP = 6; // lines the HUD shows

// A chat line as the server will broadcast it, or null when the text is unusable. Control characters
// and surrounding whitespace go; the text is cut at CHAT_MAX_CHARS code points.
export function sanitizeChat(text) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (clean.length === 0) return null;
  return [...clean].slice(0, CHAT_MAX_CHARS).join('');
}

// Chat pacing: `last` is the player's previous accepted chat time (or -Infinity).
export const chatAllowed = (last, nowMs) => nowMs - last >= CHAT_MIN_INTERVAL_MS;

// Streak milestones (kills without dying). Only exact hits announce, so a 4-streak is quiet.
export const STREAKS = Object.freeze({ 3: 'Killing Spree', 5: 'Rampage', 7: 'Unstoppable', 10: 'Godlike', 15: 'Legendary' });
export const streakText = (streak) => STREAKS[streak] ?? null;

// Multi-kill: kills within MULTI_WINDOW_MS of each other. 2 Double, 3 Triple, 4+ Multi.
export const MULTI_WINDOW_MS = 4000;
export function multiKillText(count) {
  if (count === 2) return 'Double Kill';
  if (count === 3) return 'Triple Kill';
  if (count >= 4) return 'Multi Kill';
  return null;
}

// Advance a player's streak bookkeeping after a kill at nowMs. Returns the announcements to make.
export function recordKill(p, nowMs) {
  p.streak = (p.streak | 0) + 1;
  p.multi = nowMs - (p.lastKillAt ?? -Infinity) <= MULTI_WINDOW_MS ? (p.multi | 0) + 1 : 1;
  p.lastKillAt = nowMs;
  return { streak: p.streak, streakText: streakText(p.streak), multi: p.multi, multiText: multiKillText(p.multi) };
}

export function resetStreak(p) {
  const ended = p.streak | 0;
  p.streak = 0;
  p.multi = 0;
  p.lastKillAt = -Infinity;
  return ended;
}

// Feed line when a streak of 5 or more ends.
export const streakEndedText = (killerName, victimName, ended) => (ended >= 5 ? `${killerName} ended ${victimName}'s ${ended} kill streak` : null);
