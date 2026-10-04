import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUES, CUE_IDS, cueFor, falloff, Audio, panFor } from '../../src/client/audio.js';
import { busGain, cutoffFor, isDistant, clampLevel, DEFAULT_LEVELS, BUSES } from '../../src/client/audioModel.js';

test('cueFor maps events to cues and stays silent for other players private cues; far gunfire picks the distant variant', () => {
  assert.equal(cueFor('shot', { w: 'sniper' }), 'shot_sniper');
  assert.equal(cueFor('shot', { w: 'laser' }), 'shot_rifle');
  assert.equal(cueFor('shot', { w: 'rifle', d: 45 }), 'shot_distant');
  assert.equal(cueFor('shot', { w: 'rifle', d: 29 }), 'shot_rifle');
  assert.equal(cueFor('kill', { mine: true }), 'kill');
  assert.equal(cueFor('kill', { mine: false }), null);
  assert.equal(cueFor('pickup', { mine: false }), null);
  assert.equal(cueFor('ability', { denied: true, mine: false }), null);
  assert.equal(cueFor('ability', { denied: true, mine: true }), 'denied');
  assert.equal(cueFor('ability', { denied: false }), 'ability');
  assert.equal(cueFor('hit', { head: true }), 'headshot');
  assert.equal(cueFor('countdown'), 'countdown'); assert.equal(cueFor('countdown', { go: true }), 'go');
  assert.equal(cueFor('ui', { kind: 'hover' }), 'ui_hover'); assert.equal(cueFor('ui', { kind: 'bogus' }), 'ui_click');
  for (const ev of ['reload', 'switch', 'empty', 'jump', 'land', 'slide', 'medal', 'damage', 'step']) assert.ok(CUES[cueFor(ev)], ev);
  assert.equal(cueFor('nothing'), null);
  assert.ok(CUE_IDS.length >= 30, `a real palette (${CUE_IDS.length} cues)`);
  for (const [id, c] of Object.entries(CUES)) {
    assert.ok(BUSES.includes(c.bus) && c.bus !== 'master', `${id} on a bus`);
    assert.ok(c.layers.length >= 1);
    for (const L of c.layers) { assert.ok(L.dur > 0 && L.gain > 0 && L.gain <= 1, `${id} layer`); assert.ok(['osc', 'noise', 'sub'].includes(L.kind)); if (L.kind !== 'noise') assert.ok(L.f0 > 0 && L.f1 > 0); }
    const peak = c.layers.reduce((a, L) => a + L.gain, 0);
    assert.ok(peak <= 1.9, `${id} does not clip (${peak})`);
  }
});

test('falloff: full inside 4 m, zero at 60 m, full when distance is unknown', () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(4), 1);
  assert.equal(falloff(32), 0.5);
  assert.equal(falloff(60), 0);
  assert.equal(falloff(NaN), 1);
});

test('audio math: pan follows the listener yaw, lowpass drops with distance, bus gains multiply, levels clamp', () => {
  const me = { x: 0, z: 0, yaw: 0 }; // looking toward -Z
  assert.ok(Math.abs(panFor(me, [0, 0, -10])) < 1e-9, 'straight ahead');
  assert.ok(Math.abs(panFor(me, [0, 0, 10])) < 1e-9, 'behind');
  assert.ok(panFor(me, [10, 0, 0]) > 0.8, 'right');
  assert.ok(panFor(me, [-10, 0, 0]) < -0.8, 'left');
  assert.ok(Math.abs(panFor({ x: 0, z: 0, yaw: Math.PI / 2 }, [0, 0, 10])) > 0.8, 'turned 90 degrees: behind becomes a side');
  assert.equal(panFor(me, [0.1, 0, 0.1]), 0, 'on top of me: centred');
  assert.equal(cutoffFor(0), 18000); assert.ok(cutoffFor(30) < 11000 && cutoffFor(30) > 9000); assert.equal(cutoffFor(200), 900);
  assert.equal(isDistant(30), true); assert.equal(isDistant(29.9), false);
  assert.equal(busGain({ master: 0.5, sfx: 0.5 }, 'sfx'), 0.25);
  assert.equal(busGain({ master: 2, ui: -1 }, 'ui'), 0);
  assert.equal(clampLevel(NaN), 1); assert.equal(clampLevel(0.3), 0.3);
  assert.deepEqual(Object.keys(DEFAULT_LEVELS).sort(), [...BUSES].sort());
});

function fakeContext(nodes) {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (kind) => { const n = { kind, type: '', connect(to) { n.to = to; }, start() {}, stop() {}, gain: param(), frequency: param(), pan: param() }; nodes.push(n); return n; };
  return class FakeCtx {
    currentTime = 0; sampleRate = 8000; destination = { kind: 'dest' };
    createGain() { return node('gain'); }
    createOscillator() { return node('osc'); }
    createBufferSource() { return node('src'); }
    createStereoPanner() { return node('pan'); }
    createBiquadFilter() { return node('filter'); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  };
}

test('Audio without an AudioContext is inert; with a fake one it builds a graph per cue, pans positioned cues, filters far ones, respects buses and the node cap', () => {
  const silent = new Audio({ AudioContextClass: null });
  assert.equal(silent.available, false);
  assert.equal(silent.unlock(), false);
  assert.equal(silent.play('hit'), false);
  const nodes = [];
  const a = new Audio({ AudioContextClass: fakeContext(nodes) });
  assert.equal(a.play('hit'), false, 'nothing before unlock');
  assert.equal(a.unlock(), true);
  assert.equal(a.play('hit'), true);
  assert.ok(nodes.some((n) => n.kind === 'osc'));
  assert.equal(nodes.filter((n) => n.kind === 'pan').length, 0, 'no panner for a cue on the listener');
  nodes.length = 0;
  assert.equal(a.play('boom', 0.5), true);
  assert.ok(nodes.some((n) => n.kind === 'src'), 'noise burst for a noisy cue');
  nodes.length = 0;
  a.setListener(0, 0, 0);
  assert.equal(a.play('shot_rifle', 0.6, [20, 0, 0]), true);
  const pan = nodes.find((n) => n.kind === 'pan');
  assert.ok(pan && pan.pan.value > 0.5, 'panned right');
  const lp = nodes.filter((n) => n.kind === 'filter').find((n) => n.type === 'lowpass' && n.frequency.value < 18000);
  assert.ok(lp, 'distance lowpass');
  assert.equal(a.setLevel('sfx', 0.5), true); assert.equal(a.setLevel('bogus', 0.5), false);
  assert.equal(a.levels.sfx, 0.5);
  a.setLevel('master', 0.25);
  assert.equal(a.levels.master, 0.25);
  a.setEnabled(false);
  assert.equal(a.play('hit'), false);
  a.setEnabled(true);
  assert.equal(a.play('hit', 0), false);
  for (let i = 0; i < 60; i++) a.play('step');
  assert.equal(a.play('step'), false, 'node cap holds under a burst');
});
