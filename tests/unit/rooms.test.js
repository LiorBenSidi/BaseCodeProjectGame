// SPEC 26: room ids, codes, registry rows and the lobby view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoomCode, makeRoomId, parseRoomId, isRoomId, modeForRoomId, roomIdFromLocation, roomLink, roomRow, lobbyRooms, quickPlayRoom, ROOM_CODE_ALPHABET, LEGACY_ROOM_ID } from '../../src/shared/rooms.js';

test('room codes use the unambiguous alphabet and the requested length', () => {
  const c = newRoomCode(() => 0.999);
  assert.equal(c.length, 6);
  assert.equal(c, ROOM_CODE_ALPHABET.at(-1).repeat(6));
  assert.equal(newRoomCode(() => 0), 'aaaaaa');
  assert.ok(!/[ilo01]/.test(ROOM_CODE_ALPHABET));
});

test('parseRoomId accepts <mode>-<code>, the legacy room and diag rooms; rejects the rest', () => {
  assert.deepEqual(parseRoomId('tdm-abc234'), { mode: 'tdm', code: 'abc234' });
  assert.deepEqual(parseRoomId(makeRoomId('dm', 'q2w3e4')), { mode: 'dm', code: 'q2w3e4' });
  assert.deepEqual(parseRoomId(LEGACY_ROOM_ID), { mode: 'dm', code: 'arena-1' });
  assert.equal(parseRoomId('diag-live-6').mode, 'dm');
  assert.equal(parseRoomId('ctf-abc234'), null);
  assert.equal(parseRoomId('dm-ABC'), null);
  assert.equal(parseRoomId('dm-'), null);
  assert.equal(parseRoomId('a/b'), null);
  assert.equal(parseRoomId(42), null);
  assert.equal(isRoomId('tdm-abcd'), true);
  assert.equal(modeForRoomId('tdm-abcd'), 'tdm');
  assert.equal(modeForRoomId('arena-1'), 'dm');
  assert.equal(modeForRoomId('garbage'), 'dm');
});

test('roomIdFromLocation reads ?room= and falls back on anything else', () => {
  assert.equal(roomIdFromLocation('?room=tdm-abcd'), 'tdm-abcd');
  assert.equal(roomIdFromLocation('?room=../x'), LEGACY_ROOM_ID);
  assert.equal(roomIdFromLocation(''), LEGACY_ROOM_ID);
  assert.equal(roomIdFromLocation('?room=nope', 'dm-fallbk'), 'dm-fallbk');
  assert.equal(roomLink('https://x.app', 'tdm-abcd'), 'https://x.app/?room=tdm-abcd');
});

test('roomRow derives status and lobbyRooms hides stale, empty and full rows, fullest first', () => {
  const now = 1_700_000_000_000;
  const row = roomRow({ roomId: 'dm-aaaaaa', mode: 'dm', players: 3, maxPlayers: 16, phase: 'playing', matchNumber: 2, nowMs: now });
  assert.equal(row.status, 'open');
  assert.equal(row.last_seen, new Date(now).toISOString());
  assert.equal(roomRow({ roomId: 'dm-aaaaaa', mode: 'dm', players: 0, maxPlayers: 16, phase: 'waiting', matchNumber: 0, nowMs: now }).status, 'empty');
  assert.equal(roomRow({ roomId: 'dm-aaaaaa', mode: 'dm', players: 16, maxPlayers: 16, phase: 'playing', matchNumber: 1, nowMs: now }).status, 'full');
  const rows = [
    row,
    { ...row, room_id: 'tdm-bbbbbb', mode: 'tdm', players: 7 },
    { ...row, room_id: 'dm-cccccc', players: 9, last_seen: new Date(now - 200_000).toISOString() },
    { ...row, room_id: 'dm-dddddd', status: 'empty', players: 0 },
    { ...row, room_id: 'bad id', players: 12 },
  ];
  assert.deepEqual(lobbyRooms(rows, now).map((r) => r.id), ['tdm-bbbbbb', 'dm-aaaaaa']);
  assert.equal(quickPlayRoom(rows, 'dm', now), 'dm-aaaaaa');
  assert.equal(quickPlayRoom(rows, 'tdm', now), 'tdm-bbbbbb');
  assert.equal(quickPlayRoom([], 'tdm', now, () => 0), 'tdm-aaaaaa');
});
