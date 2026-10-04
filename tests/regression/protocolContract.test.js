// Contract invariants (D-034, after gsp-sim-bench tests/Unit_Tests/test_contract_invariants.py): the wire protocol is
// read from the source files themselves, so a message type added on one side without the other fails here, not in
// production. Known gotcha this guards: src/server/server.js and src/server/matchSession.js each dispatch client
// messages (V1 lesson), and the client's handler table must know every server message type the room can send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const code = (p) => read(p).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n'); // comments are not protocol
const types = (src, re) => new Set([...src.matchAll(re)].map((m) => m[1]));

const parsedClientTypes = types(read('src/server/protocol.js'), /case '([a-zA-Z]+)':/g);
parsedClientTypes.delete('static'); parsedClientTypes.delete('vite');

test('every client message type the protocol accepts is dispatched by BOTH the Node server and the actor session', () => {
  const dispatchRe = /(?:case '([a-zA-Z]+)'|msg\.t === '([a-zA-Z]+)')/g;
  const dispatched = (p) => new Set([...code(p).matchAll(dispatchRe)].map((m) => m[1] ?? m[2]));
  const server = dispatched('src/server/server.js');
  const session = dispatched('src/server/matchSession.js');
  for (const t of parsedClientTypes) {
    if (t === 'ping') continue; // answered by the shared answerPing() before dispatch
    assert.ok(server.has(t), `server.js does not dispatch '${t}'`);
    assert.ok(session.has(t), `matchSession.js does not dispatch '${t}'`);
  }
  assert.ok(parsedClientTypes.size >= 12, `expected the V1 message set, saw ${[...parsedClientTypes].join(', ')}`);
});

test('every server message type the room or session can send has a client handler', () => {
  const sent = new Set();
  for (const f of ['src/server/GameRoom.js', 'src/server/matchSession.js', 'src/server/server.js']) for (const t of types(code(f), /\{ t: '([a-zA-Z]+)'/g)) sent.add(t);
  for (const t of ['none', 'primary', 'sidearm', 'rejoin', 'hit']) sent.delete(t); // weapon slots, grenade reasons, nested kinds
  const client = read('src/client/game.js');
  const start = client.indexOf('const handlers = {');
  const handlers = types(client.slice(start, client.indexOf('};', start)), /^\s+([a-zA-Z]+):/gm);
  for (const t of sent) assert.ok(handlers.has(t), `game.js has no handler for server message '${t}'`);
  assert.ok(sent.size >= 15, `expected the full server vocabulary, saw ${[...sent].join(', ')}`);
});

test('the actor mirror carries every shared module (replica parity, as tests/System_Tests/test_replica_parity.py)', () => {
  const shared = fs.readdirSync(path.join(root, 'src/shared')).filter((f) => f.endsWith('.js')).sort();
  const mirrored = fs.readdirSync(path.join(root, 'base44/actors/Match/shared')).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(mirrored, shared);
  for (const f of shared) assert.equal(read(`base44/actors/Match/shared/${f}`), read(`src/shared/${f}`), `${f} drifted between src and the actor`);
});
