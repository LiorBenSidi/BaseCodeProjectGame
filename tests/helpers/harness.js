// Shared black-box test harness for startServer() (SPEC section 12).
// Not a test file (no .test.js suffix): it is imported by the integration/security/system/stress tests.
import http from 'node:http';
import { afterEach, beforeEach } from 'node:test';
import WebSocket from 'ws';
import { startServer } from '../../src/server/server.js';

/** Per-command displacement at full speed: PLAYER.speed * INPUT_DT (SPEC sections 1 and 3). */
export const STEP = 7 / 60;
/** Server consumes at most this many queued commands per player per tick (SPEC section 10). */
export const MAX_CMDS_PER_TICK = 4;

export function cmd(seq, o = {}) {
  return { seq, fwd: 0, right: 0, jump: false, yaw: 0, pitch: 0, ...o };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until predicate returns a truthy value; throws on timeout. Never a blind sleep. */
export async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 5, what = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms: ${what}`);
    await delay(intervalMs);
  }
}

export async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Raw HTTP request that never normalises the path. */
export function httpRequest(port, { method = 'GET', path = '/', headers = {}, host = '127.0.0.1', timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.request(
      { host, port, method, path, headers: { connection: 'close', ...headers }, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            text: body.toString('utf8'),
            elapsedMs: performance.now() - started,
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`http timeout: ${method} ${path}`)));
    req.end();
  });
}

export class WsClient {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.binaryCount = 0;
    this.unparsable = [];
    this.errors = [];
    this.snapTimes = [];
    this.closed = false;
    this.closeCode = null;
    this.closeReason = '';
    this.id = null;
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.binaryCount += 1;
        return;
      }
      const text = data.toString('utf8');
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        this.unparsable.push(text);
        return;
      }
      this.messages.push(obj);
      if (obj && obj.t === 'snap') this.snapTimes.push(performance.now());
    });
    ws.on('close', (code, reason) => {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = reason ? reason.toString() : '';
    });
    ws.on('error', (err) => this.errors.push(err));
  }

  get isOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }
  get snaps() {
    return this.messages.filter((m) => m && m.t === 'snap');
  }
  get lastSnap() {
    const s = this.snaps;
    return s.length ? s[s.length - 1] : null;
  }
  ofType(t) {
    return this.messages.filter((m) => m && m.t === t);
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  sendRaw(data, opts) {
    this.ws.send(data, opts);
  }
  /** This player's entry in the latest snapshot (or undefined). */
  me() {
    const s = this.lastSnap;
    return s && this.id !== null ? s.players.find((p) => p.id === this.id) : undefined;
  }
  async waitForMe(timeoutMs = 3000) {
    await waitFor(() => this.me(), { timeoutMs, what: 'own player in a snapshot' });
    return this.me();
  }
  async nextSnaps(n, timeoutMs = 4000) {
    const start = this.snaps.length;
    await waitFor(() => this.snaps.length >= start + n, { timeoutMs, what: `${n} more snapshots` });
    return this.snaps.slice(start);
  }
  async join(name) {
    this.send(name === undefined ? { t: 'join' } : { t: 'join', name });
    const welcome = await waitFor(() => this.ofType('welcome')[0], { what: 'welcome message' });
    this.id = welcome.id;
    await waitFor(() => this.me(), { what: 'own player in a snapshot after join' });
    return welcome.id;
  }
  async waitClosed(timeoutMs = 3000) {
    await waitFor(() => this.closed, { timeoutMs, what: 'socket to close' });
    return this.closeCode;
  }
  async close() {
    if (this.closed) return;
    try {
      this.ws.close(1000);
    } catch {
      /* already closing */
    }
    try {
      await waitFor(() => this.closed, { timeoutMs: 1500, what: 'graceful close' });
    } catch {
      this.dispose();
    }
  }
  dispose() {
    try {
      this.ws.terminate();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Attempt a WebSocket connection.
 *  - ok:true  -> { ok, client }
 *  - HTTP rejection (403/429/...) -> { ok:false, status, headers }
 *  - destroyed socket / connection error -> { ok:false, error } (status undefined)
 * origin: undefined -> same-origin default, false -> omit header, string -> literal header value.
 */
export function tryConnect(port, { origin, path = '/ws', headers = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    if (origin !== false) h.Origin = origin === undefined ? `http://127.0.0.1:${port}` : origin;
    let ws;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: h, handshakeTimeout: timeoutMs });
    } catch (error) {
      resolve({ ok: false, error });
      return;
    }
    const client = new WsClient(ws);
    let settled = false;
    const done = (r) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    ws.once('open', () => done({ ok: true, client }));
    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode;
      const rHeaders = res.headers;
      res.resume();
      done({ ok: false, status, headers: rHeaders });
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    });
    ws.on('error', (error) => done({ ok: false, error }));
  });
}

/** Like tryConnect but retries while the server answers 429 (used to wait for per-IP slot release). */
export async function connectEventually(port, opts = {}, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const r = await tryConnect(port, opts);
    if (r.ok || r.status !== 429 || Date.now() - start > timeoutMs) return r;
    await delay(10);
  }
}

export async function startTestServer(overrides = {}) {
  const logs = [];
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    isProd: false,
    allowedOrigins: [],
    logLevel: 'error',
    client: 'none',
    sink: (line) => logs.push(line),
    ...overrides,
  });
  return { server, port: server.port, room: server.room, logs, close: () => server.close() };
}

/**
 * Registers beforeEach/afterEach on the enclosing describe (or file) so every test gets a fresh server
 * and every client is disposed and the server closed afterwards.
 */
export function useServer(overrides = {}) {
  const ctx = { server: null, port: 0, room: null, logs: [], clients: [] };
  beforeEach(async () => {
    const t = await startTestServer(overrides);
    ctx.server = t.server;
    ctx.port = t.port;
    ctx.room = t.room;
    ctx.logs = t.logs;
    ctx.clients = [];
  });
  afterEach(async () => {
    try {
      for (const c of ctx.clients) c.dispose();
    } finally {
      if (ctx.server) await ctx.server.close();
      ctx.server = null;
    }
  });
  ctx.tryOpen = async (o = {}) => {
    const r = o.retry429 ? await connectEventually(ctx.port, o) : await tryConnect(ctx.port, o);
    if (r.ok) ctx.clients.push(r.client);
    return r;
  };
  ctx.open = async (o = {}) => {
    const r = await ctx.tryOpen(o);
    if (!r.ok) throw new Error(`connect failed: ${JSON.stringify({ status: r.status, error: r.error && r.error.message })}`);
    return r.client;
  };
  ctx.readyz = async () => JSON.parse((await httpRequest(ctx.port, { path: '/readyz' })).text);
  return ctx;
}

/**
 * Join a fresh client and drive it forward with `cmds(seq)` until it demonstrably moved horizontally by at
 * least minDist (a random spawn can be blocked by a wall, so several attempts are made).
 */
export async function moveUntilMoved(ctx, { attempts = 8, name = 'Mover', seqs = [1, 2, 3, 4], make = (seq) => cmd(seq, { fwd: 1 }), minDist = 0.05 } = {}) {
  const last = seqs[seqs.length - 1];
  for (let i = 0; i < attempts; i++) {
    const client = await ctx.open({ retry429: true });
    await client.join(name);
    const before = await client.waitForMe();
    client.send({ t: 'input', cmds: seqs.map((s) => make(s)) });
    await waitFor(() => client.lastSnap && client.lastSnap.ack >= last, { what: `ack >= ${last}` });
    const after = client.me();
    const dist = Math.hypot(after.x - before.x, after.z - before.z);
    if (dist >= minDist) return { client, before, after, dist };
    await client.close();
  }
  throw new Error(`no spawn allowed movement in ${attempts} attempts`);
}

/**
 * Damage a wire player using a second, room-injected shooter (SPEC section 10 lets tests use the live
 * room). Returns true when the victim's hp dropped. Tries several bearings because walls may block one.
 */
export async function damageViaRoom(ctx, victim) {
  const v = await victim.waitForMe();
  const bearings = [
    { dx: 0, dz: 3, yaw: 0 },
    { dx: 0, dz: -3, yaw: Math.PI },
    { dx: 3, dz: 0, yaw: Math.PI / 2 },
    { dx: -3, dz: 0, yaw: -Math.PI / 2 },
    { dx: 0, dz: 1.5, yaw: 0 },
    { dx: 0, dz: -1.5, yaw: Math.PI },
    { dx: 1.5, dz: 0, yaw: Math.PI / 2 },
    { dx: -1.5, dz: 0, yaw: -Math.PI / 2 },
  ];
  for (const b of bearings) {
    const shooter = ctx.room.addPlayer({ send() {}, name: 'Shooter' });
    if (!shooter) throw new Error('room refused injected shooter');
    Object.assign(shooter, { x: v.x + b.dx, y: 0, z: v.z + b.dz, yaw: b.yaw, pitch: 0 });
    ctx.room.handleShoot(shooter.id);
    try {
      await waitFor(() => victim.me() && victim.me().hp < 100, { timeoutMs: 600, what: 'victim hp to drop' });
    } catch {
      /* this bearing was blocked; try the next */
    }
    ctx.room.removePlayer(shooter.id);
    if (victim.me() && victim.me().hp < 100) return true;
  }
  return false;
}
