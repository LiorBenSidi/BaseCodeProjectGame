import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveJoinInput, accountLine, roomLabel, describeRoom } from '../../src/client/lobby.js';

test('resolveJoinInput accepts a room id or a join link, rejects bare codes and junk', () => {
  assert.equal(resolveJoinInput(' tdm-abc234 '), 'tdm-abc234');
  assert.equal(resolveJoinInput('https://x.app/?room=dm-q2w3e4&x=1'), 'dm-q2w3e4');
  assert.equal(resolveJoinInput('https://x.app/?room=../x'), null);
  assert.equal(resolveJoinInput('abc234'), null);
  assert.equal(resolveJoinInput(''), null);
  assert.equal(resolveJoinInput(null), null);
});

test('labels', () => {
  assert.equal(accountLine(null), 'Not signed in: stats are not saved');
  assert.equal(accountLine({ full_name: 'Lior' }), 'Signed in as Lior');
  assert.equal(accountLine({ email: 'a@b.c' }), 'Signed in as a@b.c');
  assert.equal(roomLabel({ mode: 'tdm', players: 3, max: 16, phase: 'playing' }), 'Team Deathmatch  3 / 16  in match');
  assert.equal(describeRoom('tdm-abc234'), 'tdm-abc234 (Team Deathmatch)');
  assert.equal(describeRoom('arena-1'), 'arena-1 (Deathmatch)');
  assert.equal(describeRoom('weird'), 'weird');
});
