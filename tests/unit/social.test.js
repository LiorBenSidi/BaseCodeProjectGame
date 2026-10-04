// SPEC 29.1 / 29.2: chat sanitizing and pacing, streaks and multi-kills, and the room's relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChat, chatAllowed, recordKill, resetStreak, streakText, multiKillText, streakEndedText, CHAT_MAX_CHARS } from '../../src/shared/social.js';
import { GameRoom } from '../../src/server/GameRoom.js';
import { validateClientMessage } from '../../src/server/protocol.js';

test('sanitizeChat strips control characters, trims, caps at 120 code points, rejects empties', () => {
  assert.equal(sanitizeChat('  gg \u0007 wp  '), 'gg   wp');
  assert.equal(sanitizeChat('x'.repeat(300)).length, CHAT_MAX_CHARS);
  assert.equal(sanitizeChat('😀'.repeat(130)).length, CHAT_MAX_CHARS * 2, 'code points, not UTF-16 units');
  assert.equal(sanitizeChat('   '), null);
  assert.equal(sanitizeChat(42), null);
  assert.equal(chatAllowed(-Infinity, 0), true);
  assert.equal(chatAllowed(1000, 1500), false);
  assert.equal(chatAllowed(1000, 2000), true);
});

test('protocol accepts chat text up to 400 chars and rejects the rest', () => {
  assert.equal(validateClientMessage({ t: 'chat', text: 'hi' }).ok, true);
  assert.equal(validateClientMessage({ t: 'chat', text: '' }).ok, false);
  assert.equal(validateClientMessage({ t: 'chat', text: 'x'.repeat(401) }).ok, false);
  assert.equal(validateClientMessage({ t: 'chat', text: 5 }).ok, false);
});

test('streaks: milestones announce exactly, multi-kills need the 4 s window, a death resets', () => {
  const p = {};
  const r = [];
  for (let i = 0; i < 5; i++) r.push(recordKill(p, 1000 + i * 1000));
  assert.equal(r[2].streakText, 'Killing Spree');
  assert.equal(r[3].streakText, null);
  assert.equal(r[4].streakText, 'Rampage');
  assert.equal(r[1].multiText, 'Double Kill');
  assert.equal(r[2].multiText, 'Triple Kill');
  assert.equal(r[4].multiText, 'Multi Kill');
  const late = recordKill(p, 20_000);
  assert.equal(late.multi, 1);
  assert.equal(late.streak, 6);
  assert.equal(resetStreak(p), 6);
  assert.equal(p.streak, 0);
  assert.equal(streakText(10), 'Godlike');
  assert.equal(multiKillText(1), null);
  assert.equal(streakEndedText('A', 'B', 4), null);
  assert.equal(streakEndedText('A', 'B', 5), "A ended B's 5 kill streak");
});

test('room relays sanitized chat with name and team, once per second per player', () => {
  let t = 1_000_000;
  const sent = [];
  const room = new GameRoom({ now: () => t });
  const a = room.addPlayer({ name: 'A', send: (m) => sent.push(['a', m]) });
  room.addPlayer({ name: 'B', send: (m) => sent.push(['b', m]) });
  assert.equal(room.handleChat(a.id, '  hello \u0001there '), true);
  const got = sent.filter(([, m]) => m.t === 'chat');
  assert.equal(got.length, 2, 'both players receive it');
  assert.deepEqual(got[0][1], { t: 'chat', id: a.id, name: 'A', team: -1, text: 'hello  there' });
  assert.equal(room.handleChat(a.id, 'spam'), false, 'second line inside a second is dropped');
  t += 1000;
  assert.equal(room.handleChat(a.id, 'ok now'), true);
  assert.equal(room.handleChat(a.id + 99, 'ghost'), false);
  assert.equal(room.handleChat(a.id, '   '), false);
});
