import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/server/config.js';

test('empty env yields the documented defaults', () => {
  assert.deepEqual(loadConfig({}), {
    port: 3000,
    host: '0.0.0.0',
    isProd: false,
    allowedOrigins: [],
    logLevel: 'info',
  });
});

test('PORT is parsed into a number', () => {
  assert.strictEqual(loadConfig({ PORT: '8080' }).port, 8080);
});

test('PORT lower boundary 1 is accepted', () => {
  assert.strictEqual(loadConfig({ PORT: '1' }).port, 1);
});

test('PORT upper boundary 65535 is accepted', () => {
  assert.strictEqual(loadConfig({ PORT: '65535' }).port, 65535);
});

for (const bad of ['0', '65536', '-1', '-3000', 'abc', '80.5', 'NaN', 'Infinity', '99999999999999999999', '8080abc', 'abc8080']) {
  test(`PORT=${JSON.stringify(bad)} throws an Error mentioning PORT`, () => {
    assert.throws(
      () => loadConfig({ PORT: bad }),
      (e) => e instanceof Error && e.message.includes('PORT'),
    );
  });
}

test('HOST is passed through', () => {
  assert.strictEqual(loadConfig({ HOST: '127.0.0.1' }).host, '127.0.0.1');
});

test('NODE_ENV=production sets isProd true', () => {
  assert.strictEqual(loadConfig({ NODE_ENV: 'production' }).isProd, true);
});

for (const notProd of ['development', 'test', 'Production', 'PRODUCTION', 'prod', 'production ', ' production', 'productions']) {
  test(`NODE_ENV=${JSON.stringify(notProd)} does not count as production`, () => {
    assert.strictEqual(loadConfig({ NODE_ENV: notProd }).isProd, false);
  });
}

test('missing NODE_ENV is not production', () => {
  assert.strictEqual(loadConfig({}).isProd, false);
});

test('ALLOWED_ORIGINS are split on commas, trimmed, lowercased, with empties dropped', () => {
  const cfg = loadConfig({ ALLOWED_ORIGINS: ' HTTP://A.com , ,http://b.com,, ' });
  assert.deepEqual(cfg.allowedOrigins, ['http://a.com', 'http://b.com']);
});

test('ALLOWED_ORIGINS of only commas and spaces yields an empty list', () => {
  assert.deepEqual(loadConfig({ ALLOWED_ORIGINS: ' , ,,  ' }).allowedOrigins, []);
});

test('ALLOWED_ORIGINS single entry', () => {
  assert.deepEqual(loadConfig({ ALLOWED_ORIGINS: 'https://Game.Example.com' }).allowedOrigins, [
    'https://game.example.com',
  ]);
});

test('ALLOWED_ORIGINS preserves order', () => {
  assert.deepEqual(loadConfig({ ALLOWED_ORIGINS: 'https://z.com,https://a.com' }).allowedOrigins, [
    'https://z.com',
    'https://a.com',
  ]);
});

test('ALLOWED_ORIGINS empty string yields an empty list', () => {
  assert.deepEqual(loadConfig({ ALLOWED_ORIGINS: '' }).allowedOrigins, []);
});

for (const lvl of ['debug', 'info', 'warn', 'error']) {
  test(`LOG_LEVEL=${lvl} is accepted`, () => {
    assert.strictEqual(loadConfig({ LOG_LEVEL: lvl }).logLevel, lvl);
  });
}

for (const bad of ['verbose', 'trace', 'fatal', 'warning', '1']) {
  test(`LOG_LEVEL=${JSON.stringify(bad)} throws an Error mentioning LOG_LEVEL`, () => {
    assert.throws(
      () => loadConfig({ LOG_LEVEL: bad }),
      (e) => e instanceof Error && e.message.includes('LOG_LEVEL'),
    );
  });
}

test('loadConfig never reads process.env (pure function of its argument)', () => {
  const saved = { PORT: process.env.PORT, HOST: process.env.HOST, NODE_ENV: process.env.NODE_ENV };
  process.env.PORT = '9999';
  process.env.HOST = 'evil.example';
  process.env.NODE_ENV = 'production';
  try {
    const cfg = loadConfig({});
    assert.strictEqual(cfg.port, 3000);
    assert.strictEqual(cfg.host, '0.0.0.0');
    assert.strictEqual(cfg.isProd, false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('loadConfig works on a frozen env and does not mutate it', () => {
  const env = Object.freeze({ PORT: '4000', ALLOWED_ORIGINS: 'http://x.com' });
  const cfg = loadConfig(env);
  assert.strictEqual(cfg.port, 4000);
  assert.deepEqual({ ...env }, { PORT: '4000', ALLOWED_ORIGINS: 'http://x.com' });
});

test('two loadConfig calls return independent allowedOrigins arrays', () => {
  const env = { ALLOWED_ORIGINS: 'http://x.com' };
  const a = loadConfig(env);
  a.allowedOrigins.push('http://mutated.com');
  assert.deepEqual(loadConfig(env).allowedOrigins, ['http://x.com']);
});

test('the returned config has exactly the documented keys', () => {
  assert.deepEqual(Object.keys(loadConfig({})).sort(), ['allowedOrigins', 'host', 'isProd', 'logLevel', 'port']);
});
