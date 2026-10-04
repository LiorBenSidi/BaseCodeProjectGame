// First run tutorial (SPEC 35.4, D-032). Pure step logic: the HUD renders `current(state)`, the game feeds
// `advance(state, event)` with what the player just did, and the state is a plain object the caller persists.
// Steps advance on real actions, never on timers, so a player who already knows the game blows through them.
export const STEPS = Object.freeze([
  Object.freeze({ id: 'move', title: 'Move', text: 'WASD to move. Hold Shift to sprint.', event: 'move' }),
  Object.freeze({ id: 'look', title: 'Look', text: 'Move the mouse to look around.', event: 'look' }),
  Object.freeze({ id: 'jump', title: 'Jump', text: 'Space to jump. Press it again on a wall to mantle.', event: 'jump' }),
  Object.freeze({ id: 'slide', title: 'Slide', text: 'Sprint, then tap C to slide under fire.', event: 'slide' }),
  Object.freeze({ id: 'shoot', title: 'Shoot', text: 'Click to fire at a dummy. Right click to aim down sights.', event: 'hit' }),
  Object.freeze({ id: 'reload', title: 'Reload', text: 'R reloads. Empty magazines lose fights.', event: 'reload' }),
  Object.freeze({ id: 'switch', title: 'Switch weapon', text: '1 and 2 swap between your primary and sidearm.', event: 'switch' }),
  Object.freeze({ id: 'grenade', title: 'Grenade', text: 'G throws a grenade. It bounces, so aim at the floor.', event: 'throw' }),
  Object.freeze({ id: 'ability', title: 'Kit abilities', text: 'Q and E use your kit abilities. Watch the cooldown ring.', event: 'ability' }),
  Object.freeze({ id: 'done', title: 'Ready', text: 'That is the range. Quick Play puts you in a real match.', event: null }),
]);
export const STEP_IDS = Object.freeze(STEPS.map((s) => s.id));
export const STORAGE_KEY = 'bca.tutorialDone';

export const newTutorial = () => ({ step: 0, done: false, shownAt: null });

export const current = (state) => (state.done ? null : STEPS[Math.min(state.step, STEPS.length - 1)]);

// Feeds an action. Returns true when the step advanced. The final step completes on `dismiss`.
export function advance(state, event) {
  if (state.done) return false;
  const step = STEPS[state.step];
  if (!step) { state.done = true; return false; }
  if (step.event === null) { if (event === 'dismiss') { state.done = true; return true; } return false; }
  if (event === 'skip') { state.done = true; return true; }
  if (event !== step.event) return false;
  state.step += 1;
  if (state.step >= STEPS.length) state.done = true;
  return true;
}

export const progress = (state) => ({ index: Math.min(state.step, STEPS.length - 1) + 1, total: STEPS.length });

// Should the tutorial start? Only in a practice range, only if never finished.
export const shouldStart = (modeId, storage) => modeId === 'range' && storage?.getItem?.(STORAGE_KEY) !== '1';
export const markDone = (storage) => storage?.setItem?.(STORAGE_KEY, '1');

// Contextual tips for the first live matches: one line each, shown once, in order, when the trigger fires.
export const TIPS = Object.freeze([
  Object.freeze({ id: 'tip_tab', on: 'matchStart', text: 'Tab shows the scoreboard. Enter opens chat.' }),
  Object.freeze({ id: 'tip_minimap', on: 'firstShotHeard', text: 'Enemies who fire show on the minimap for two seconds.' }),
  Object.freeze({ id: 'tip_death', on: 'death', text: 'The kill cam shows how you died. Watch where they stood.' }),
  Object.freeze({ id: 'tip_ads', on: 'firstHit', text: 'Aim down sights for tighter spread; hip fire for speed.' }),
  Object.freeze({ id: 'tip_streak', on: 'kill', text: 'Three kills in a row starts a streak. Medals follow.' }),
]);
export const TIPS_KEY = 'bca.tipsSeen';

export function nextTip(trigger, seen) {
  for (const t of TIPS) if (t.on === trigger && !seen.includes(t.id)) return t;
  return null;
}
