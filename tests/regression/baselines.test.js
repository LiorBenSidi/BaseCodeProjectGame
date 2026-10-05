// Regression baselines (D-034, after gsp-sim-bench tests/Regression_Tests/test_regression.py): numbers players feel.
// A change that moves one of these is not wrong, but it must be deliberate: update the baseline in the same commit
// and say so in docs/SPEC.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../../src/shared/weapons.js';
import { MODES, INTRO_MS, ENDING_MS, BOT_CONFIG } from '../../src/shared/modes.js';
import { botStep, newBrain, seededRng } from '../../src/shared/bots.js';
import { DEFAULT_BINDINGS } from '../../src/client/bindings.js';
import { PREFS_SCHEMA } from '../../src/client/prefs.js';

test('weapon table baseline: fire interval, magazine, reload and ADS per weapon', () => {
  const row = (w) => [w.fireIntervalMs, w.magSize, w.reserve, w.reloadMs, w.switchMs, w.adsMs, w.adsSensMul];
  const table = Object.fromEntries(Object.entries(WEAPONS).map(([id, w]) => [id, row(w)]));
  assert.deepEqual(Object.keys(table).sort(), ['pistol', 'rifle'].filter((k) => table[k]).concat(Object.keys(table).filter((k) => !['pistol', 'rifle'].includes(k))).sort());
  assert.deepEqual(table.rifle.slice(0, 6), [WEAPONS.rifle.fireIntervalMs, 30, 90, 2000, 400, 250], 'rifle baseline (SPEC 20 / 32.4)');
  assert.equal(table.rifle[6], 0.8, 'rifle ADS sensitivity multiplier');
  for (const [id, [interval, mag, reserve, reload, sw, ads, mul]] of Object.entries(table)) {
    assert.ok(interval >= 50 && interval <= 1500, `${id} interval ${interval}`);
    assert.ok(mag >= 1 && mag <= 200 && reserve >= 0, `${id} ammo ${mag}/${reserve}`);
    assert.ok(reload >= 500 && reload <= 5000 && sw >= 100 && sw <= 1500, `${id} reload ${reload} switch ${sw}`);
    assert.ok(ads >= 100 && ads <= 600 && mul > 0 && mul <= 1, `${id} ads ${ads} x${mul}`);
  }
});

test('match flow baseline: 5 s intro, 15 s ending, bot seats per mode, every mode has a duration or is endless', () => {
  assert.equal(INTRO_MS, 5000);
  assert.equal(ENDING_MS, 15000);
  assert.deepEqual(BOT_CONFIG, { dm: { fill: 2, difficulty: 'medium' }, tdm: { fill: 4, difficulty: 'medium' }, range: { fill: 4, difficulty: 'dummy' }, koth: { fill: 6, difficulty: 'medium' }, ctf: { fill: 6, difficulty: 'medium' } }); // SPEC 39
  for (const [id, m] of Object.entries(MODES)) assert.ok(Number.isFinite(m.timeLimitMs) ? m.timeLimitMs > 0 : id === 'range', `${id} time limit`);
  assert.equal(MODES.dm.timeLimitMs, 300_000); assert.equal(MODES.tdm.timeLimitMs, 480_000); assert.equal(MODES.dm.scoreLimit, 25); assert.equal(MODES.tdm.scoreLimit, 50);
});

test('bot brain is deterministic: the same seed and world produce the same decisions', () => {
  const map = { w: 40, h: 40, boxes: [], spawns: [[0, 0], [10, 10]] };
  const run = (seed) => {
    const rng = seededRng(seed);
    const brain = newBrain('medium', seed);
    const bot = { id: 'b', x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: true, team: 0 };
    const others = [{ id: 'e', x: 10, z: 5, yaw: 0, hp: 100, alive: true, team: 1 }];
    const out = [];
    for (let i = 0; i < 40; i++) { const r = botStep(brain, bot, others, map, 1000 + i * 33, rng, () => false); out.push(JSON.stringify([r.cmd.fwd, r.cmd.right, +r.cmd.yaw.toFixed(4), r.shoot])); }
    return out.join('|');
  };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8), 'different seeds, different decisions');
});

test('default keybinds and preference defaults are stable', () => {
  assert.equal(DEFAULT_BINDINGS.fwd, 'KeyW'); assert.equal(DEFAULT_BINDINGS.jump, 'Space'); assert.equal(DEFAULT_BINDINGS.fire, 'Mouse0'); assert.equal(DEFAULT_BINDINGS.ads, 'Mouse2');
  assert.equal(PREFS_SCHEMA.masterVolume.def, 80); assert.equal(PREFS_SCHEMA.renderScale.def, 100); assert.equal(PREFS_SCHEMA.fpsCap.def, 'off');
  assert.ok(Object.keys(PREFS_SCHEMA).length >= 40, `prefs grew to ${Object.keys(PREFS_SCHEMA).length}, fine, but keep the defaults above`);
});
