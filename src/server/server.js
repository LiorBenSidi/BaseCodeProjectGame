// HTTP + WebSocket shell around GameRoom. All I/O lives here; all rules live in the modules it calls.
//
//   startServer(options) -> { port, room, close() }
//
// options: { port, host, isProd, allowedOrigins, logLevel, client: 'vite' | 'static' | 'none', sink }
// `client: 'none'` serves only /healthz, /readyz and /ws (used by integration tests).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_RATE } from '../shared/constants.js';
import { GameRoom } from './GameRoom.js';
import { createLogger } from './logger.js';
import { parseClientMessage, MAX_MESSAGE_BYTES } from './protocol.js';
import { answerPing } from './matchSession.js';
import { TokenBucket } from './rateLimit.js';
import { isAllowedOrigin } from './security.js';
import { resolveStaticPath } from './static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');

const MAX_CONNECTIONS_PER_IP = 8;
const MAX_PROTOCOL_STRIKES = 5;
const HEARTBEAT_MS = 15_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

// CSP is prod-only: Vite's dev server injects inline HMR scripts, and Base Code's preview
// embeds the app in an iframe, both of which a strict policy would break.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function applyBaseHeaders(res, isProd) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isProd) {
    res.setHeader('Content-Security-Policy', PROD_CSP);
    res.setHeader('X-Frame-Options', 'DENY');
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function serveStatic(req, res) {
  const file = resolveStaticPath(DIST, req.url ?? '/');
  if (!file) return sendText(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', st.size);
    res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

export async function startServer(options = {}) {
  const {
    port = 3000,
    host = '0.0.0.0',
    isProd = false,
    allowedOrigins = [],
    logLevel = 'info',
    client = isProd ? 'static' : 'vite',
    sink,
  } = options;

  const log = createLogger('server', { level: logLevel, ...(sink ? { sink } : {}) });
  const room = new GameRoom({ logger: createLogger('room', { level: logLevel, ...(sink ? { sink } : {}) }) });

  const httpServer = http.createServer();
  // Slowloris defence: bound how long a client may take to send headers/body.
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 15_000;
  httpServer.keepAliveTimeout = 5_000;

  let vite = null;
  if (client === 'vite') {
    const { createServer } = await import('vite');
    vite = await createServer({
      root: ROOT,
      appType: 'spa',
      // Dev-only: preview hosts (Base Code) are not known in advance. See docs/SECURITY.md.
      server: { middlewareMode: true, hmr: { server: httpServer }, allowedHosts: true },
    });
  }

  httpServer.on('request', (req, res) => {
    applyBaseHeaders(res, isProd);
    const pathname = (req.url ?? '/').split('?')[0];
    // Method check comes first so it applies to every path, including the health endpoints.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method not allowed');
    }
    if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
    if (pathname === '/readyz') return sendJson(res, 200, { status: 'ready', players: room.playerCount });
    if (client === 'vite') return vite.middlewares(req, res, () => sendText(res, 404, 'Not found'));
    if (client === 'static') return serveStatic(req, res);
    return sendText(res, 404, 'Not found');
  });

  // ---- WebSocket ------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const connectionsPerIp = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return socket.destroy();
    }
    if (pathname !== '/ws') {
      // In dev Vite's own listener handles its HMR socket; otherwise nothing else may upgrade.
      if (!vite) socket.destroy();
      return undefined;
    }
    const reject = (code, reason) => {
      socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowedOrigins)) {
      log.warn('websocket rejected: origin', { origin: String(req.headers.origin ?? '').slice(0, 100) });
      return reject(403, 'Forbidden');
    }
    const ip = req.socket.remoteAddress ?? 'unknown';
    if ((connectionsPerIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
      log.warn('websocket rejected: too many connections', { ip });
      return reject(429, 'Too Many Requests');
    }
    return wss.handleUpgrade(req, socket, head, (ws) => {
      ws.clientIp = ip;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const ip = ws.clientIp;
    connectionsPerIp.set(ip, (connectionsPerIp.get(ip) ?? 0) + 1);

    const bucket = new TokenBucket({ capacity: 120, refillPerSec: 100 });
    let player = null;
    let strikes = 0;
    const ping = { lastPingAt: null, lastPingTs: null }; // SPEC 18.2
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'text only');
      if (!bucket.take()) {
        log.warn('websocket closed: rate limit', { ip });
        return ws.close(1008, 'rate limit');
      }
      const parsed = parseClientMessage(data);
      if (!parsed.ok) {
        log.debug('bad client message', { reason: parsed.reason });
        strikes += 1;
        if (strikes >= MAX_PROTOCOL_STRIKES) ws.close(1008, 'protocol violations');
        return undefined;
      }
      const { msg } = parsed;
      if (msg.t === 'ping') {
        answerPing(ping, msg, Date.now(), (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); });
        return undefined;
      }
      if (msg.t === 'join') {
        if (player) return undefined;
        player = room.addPlayer({
          name: msg.name,
          send: (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
        });
        if (!player) {
          ws.send(JSON.stringify({ t: 'error', reason: 'room_full' }));
          ws.close(1013, 'room full');
        }
      } else if (player && msg.t === 'input') {
        room.handleInput(player.id, msg.cmds);
      } else if (player && msg.t === 'shoot') {
        room.handleShoot(player.id);
      } else if (player && msg.t === 'throw') {
        room.handleThrow(player.id);
      } else if (player && msg.t === 'reload') {
        room.handleReload(player.id);
      } else if (player && msg.t === 'switch') {
        room.handleSwitch(player.id, msg.slot);
      }
      return undefined;
    });

    ws.on('close', () => {
      const n = (connectionsPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) connectionsPerIp.delete(ip); else connectionsPerIp.set(ip, n);
      if (player) room.removePlayer(player.id);
    });
    ws.on('error', (err) => log.debug('websocket error', { err }));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  const ticker = setInterval(() => {
    try {
      room.tick();
    } catch (err) {
      log.error('tick failed', { err }); // a bug in one tick must not silently stop the game
    }
  }, 1000 / TICK_RATE);

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });
  const boundPort = httpServer.address().port;
  log.info('server listening', { host, port: boundPort, isProd, client });

  return {
    port: boundPort,
    room,
    async close() {
      clearInterval(heartbeat);
      clearInterval(ticker);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      if (vite) await vite.close();
      await new Promise((resolve) => { httpServer.close(() => resolve()); httpServer.closeAllConnections?.(); });
    },
  };
}
