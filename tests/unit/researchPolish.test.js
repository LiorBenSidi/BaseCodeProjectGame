// SPEC 36 (D-033): the research-driven polish. Telemetry math, controller curves, mix presets, prefs fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTelemetry, recordPing, recordSnapshot, stats, level, format, frameDue, WINDOW } from '../../src/client/telemetry.js';
import { applyDeadzones, responseCurve, shapeStick, CURVES } from '../../src/client/gamepadCurve.js';
import { MIXES, Audio } from '../../src/client/audio.js';
import { PREFS_SCHEMA, searchFields } from '../../src/client/prefs.js';

test('telemetry: ping is the latest sample, jitter its spread, loss the share of snapshot gaps over 2.5 ticks; windows are bounded', () => {
  const t = newTelemetry();
  assert.deepEqual(stats(t), { fps: 0, ping: null, jitter: 0, loss: 0 });
  for (const r of [40, 40, 40, 40]) recordPing(t, r);
  assert.equal(stats(t).ping, 40); assert.equal(stats(t).jitter, 0);
  recordPing(t, 80);
  assert.ok(stats(t).jitter >= 15 && stats(t).jitter <= 17, `spread ${stats(t).jitter}`);
  recordPing(t, NaN); recordPing(t, -5);
  assert.equal(t.rtts.length, 5, 'bad samples ignored');
  let now = 0;
  for (let i = 0; i < 20; i++) { recordSnapshot(t, now); now += 1000 / 60; }
  assert.equal(stats(t).loss, 0);
  now += 100; recordSnapshot(t, now); // one skipped burst
  assert.equal(stats(t).loss, 5, `1 of 20 gaps (${stats(t).loss})`);
  for (let i = 0; i < 200; i++) recordPing(t, 30);
  assert.equal(t.rtts.length, WINDOW);
  assert.equal(level({ fps: 60, ping: 30, jitter: 2, loss: 0 }), 'ok');
  assert.equal(level({ fps: 60, ping: 100, jitter: 2, loss: 0 }), 'warn');
  assert.equal(level({ fps: 60, ping: 30, jitter: 2, loss: 12 }), 'bad');
  assert.equal(level({ fps: 25, ping: null, jitter: 0, loss: 0 }), 'bad');
  assert.equal(format({ fps: 60, ping: null, jitter: 0, loss: 0 }), '60 FPS');
  assert.equal(format({ fps: 60, ping: 31, jitter: 4, loss: 1 }), '60 FPS · 31 ms · ±4 · 1% loss');
  assert.equal(frameDue(0, 5, 0), true, 'uncapped');
  assert.equal(frameDue(0, 10, 60), false); assert.equal(frameDue(0, 16, 60), true);
  assert.equal(frameDue(0, 30, 30), false); assert.equal(frameDue(0, 33, 30), true);
});

test('controller: inner deadzone kills drift, outer deadzone reaches full tilt early, curves keep sign and end at 1', () => {
  assert.equal(applyDeadzones(0.1, 0.15), 0);
  assert.equal(applyDeadzones(-0.1, 0.15), 0);
  assert.ok(Math.abs(applyDeadzones(0.15, 0.15)) < 1e-9, 'edge of the deadzone is 0, no jump');
  assert.equal(applyDeadzones(1, 0.15, 0.1), 1);
  assert.equal(applyDeadzones(0.9, 0.15, 0.1), 1, 'outer deadzone: 90 percent tilt is full');
  assert.ok(applyDeadzones(0.9, 0.15, 0) < 1);
  assert.equal(applyDeadzones(-1, 0.15), -1);
  for (const c of CURVES) {
    assert.equal(responseCurve(0, c), 0);
    assert.equal(responseCurve(1, c), 1);
    assert.equal(responseCurve(-1, c), -1);
    assert.ok(responseCurve(0.5, c) > 0 && responseCurve(-0.5, c) < 0);
  }
  assert.equal(responseCurve(0.5, 'linear'), 0.5);
  assert.ok(responseCurve(0.25, 'dynamic') < responseCurve(0.25, 'linear'), 'dynamic is slow near the centre');
  assert.ok(responseCurve(0.75, 'dynamic') > responseCurve(0.75, 'linear'), 'and fast past the middle');
  assert.ok(responseCurve(0.5, 'standard') < 0.5);
  assert.equal(shapeStick(0.05, { inner: 0.15 }), 0);
  assert.equal(shapeStick(1, { inner: 0.15, outer: 0.02, curve: 'dynamic' }), 1);
});

test('audio mix presets exist and apply through a compressor; prefs expose the new research fields', () => {
  assert.deepEqual(Object.keys(MIXES), ['default', 'night', 'headphones']);
  assert.ok(MIXES.night.ratio > MIXES.default.ratio && MIXES.night.threshold < MIXES.default.threshold, 'night compresses harder');
  const nodes = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (kind) => { const n = { kind, connect(to) { n.to = to; }, gain: param(), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }; nodes.push(n); return n; };
  class Ctx { currentTime = 0; sampleRate = 8000; destination = { kind: 'dest' }; createGain() { return node('gain'); } createDynamicsCompressor() { return node('comp'); } }
  const a = new Audio({ AudioContextClass: Ctx });
  a.unlock();
  const comp = nodes.find((n) => n.kind === 'comp');
  assert.ok(comp && comp.to.kind === 'dest', 'master -> compressor -> destination');
  assert.equal(comp.ratio.value, MIXES.default.ratio);
  assert.equal(a.setMix('night'), true);
  assert.equal(comp.ratio.value, MIXES.night.ratio);
  assert.equal(a.mix, 'night');
  assert.equal(a.setMix('loud'), false);
  for (const f of ['gamepadOuterDeadzone', 'gamepadCurve', 'renderScale', 'fpsCap', 'telemetry', 'audioMix']) assert.ok(PREFS_SCHEMA[f], f);
  assert.deepEqual(PREFS_SCHEMA.gamepadCurve.values, [...CURVES]);
  assert.deepEqual(PREFS_SCHEMA.audioMix.values, Object.keys(MIXES));
});

test('settings search: every word must match label, key, tab or an enum value; empty query matches nothing', () => {
  assert.deepEqual(searchFields(''), []);
  assert.deepEqual(searchFields('   '), []);
  assert.ok(searchFields('volume').includes('masterVolume'));
  assert.ok(searchFields('VOLUME master').includes('masterVolume') && !searchFields('volume master').includes('sfxVolume'));
  assert.ok(searchFields('night').includes('audioMix'), 'enum values are searchable');
  assert.ok(searchFields('controller curve').includes('gamepadCurve'));
  assert.ok(searchFields('video').length >= 3, 'the tab name is searchable');
  assert.deepEqual(searchFields('zzzz-no-such-setting'), []);
});
