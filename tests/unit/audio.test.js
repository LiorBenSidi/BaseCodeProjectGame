import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUES, cueFor, falloff, Audio } from '../../src/client/audio.js';

test('cueFor maps events to cues and stays silent for other players private cues', () => {
  assert.equal(cueFor('shot', { w: 'sniper' }), 'shot_sniper');
  assert.equal(cueFor('shot', { w: 'laser' }), 'shot_rifle');
  assert.equal(cueFor('kill', { mine: true }), 'kill');
  assert.equal(cueFor('kill', { mine: false }), null);
  assert.equal(cueFor('pickup', { mine: false }), null);
  assert.equal(cueFor('ability', { denied: true, mine: false }), null);
  assert.equal(cueFor('ability', { denied: true, mine: true }), 'denied');
  assert.equal(cueFor('ability', { denied: false }), 'ability');
  assert.equal(cueFor('nothing'), null);
  for (const c of Object.values(CUES)) assert.ok(c.dur > 0 && c.gain > 0 && c.gain <= 0.5);
});

test('falloff: full inside 4 m, zero at 60 m, full when distance is unknown', () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(4), 1);
  assert.equal(falloff(32), 0.5);
  assert.equal(falloff(60), 0);
  assert.equal(falloff(NaN), 1);
});

test('Audio without an AudioContext is inert; with a fake one it builds a graph per cue', () => {
  const silent = new Audio({ AudioContextClass: null });
  assert.equal(silent.available, false);
  assert.equal(silent.unlock(), false);
  assert.equal(silent.play('hit'), false);
  const nodes = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (kind) => { const n = { kind, connect() {}, start() {}, stop() {}, gain: param(), frequency: param() }; nodes.push(n); return n; };
  class FakeCtx {
    currentTime = 0; sampleRate = 8000; destination = {};
    createGain() { return node('gain'); }
    createOscillator() { return node('osc'); }
    createBufferSource() { return node('src'); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  }
  const a = new Audio({ AudioContextClass: FakeCtx });
  assert.equal(a.play('hit'), false, 'nothing before unlock');
  assert.equal(a.unlock(), true);
  assert.equal(a.play('hit'), true);
  assert.ok(nodes.some((n) => n.kind === 'osc'));
  assert.equal(a.play('boom', 0.5), true);
  assert.ok(nodes.some((n) => n.kind === 'src'), 'noise burst for a noisy cue');
  a.setEnabled(false);
  assert.equal(a.play('hit'), false);
  assert.equal(a.play('hit', 0), false);
});
