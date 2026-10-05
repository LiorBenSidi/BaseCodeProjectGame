import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrtfLocalPosition, SPATIAL_MODES, panFor } from '../../src/client/audioModel.js';
import { defaults, PREFS_SCHEMA } from '../../src/client/prefs.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('SPEC 37.6: a source straight ahead sits at negative z in the listener frame, to the right at positive x', () => {
  const L = { x: 0, z: 0, yaw: 0 }; // yaw 0 looks toward -Z
  let [x, y, z] = hrtfLocalPosition(L, [0, 0, -10]);
  near(x, 0); near(y, 0); near(z, -10);
  [x, y, z] = hrtfLocalPosition(L, [5, 1.4, 0]);
  near(x, 5); near(y, 1.4); near(z, 0);
  // turned 90 degrees left (+yaw turns left): what was ahead on -Z is now on the right
  const turned = { x: 0, z: 0, yaw: Math.PI / 2 };
  [x, , z] = hrtfLocalPosition(turned, [0, 0, -10]);
  near(x, 10); near(z, 0);
  // the horizontal sign agrees with the stereo panner for the same scene
  const side = hrtfLocalPosition(L, [3, 0, -4]);
  assert.equal(Math.sign(side[0]), Math.sign(panFor(L, [3, 0, -4])));
});

test('SPEC 37.6: the setting exists, defaults to stereo, and offers hrtf', () => {
  assert.deepEqual([...SPATIAL_MODES], ['stereo', 'hrtf']);
  assert.equal(defaults().spatialAudio, 'stereo');
  assert.deepEqual(PREFS_SCHEMA.spatialAudio.values, ['stereo', 'hrtf']);
  assert.equal(PREFS_SCHEMA.spatialAudio.tab, 'audio');
});
