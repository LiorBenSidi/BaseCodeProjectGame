// Process entry point: configuration in, signals handled. Deliberately tiny.

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { startServer } from './server.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  process.stderr.write(`Configuration error: ${err.message}\n`);
  process.exit(1);
}

const log = createLogger('main', { level: config.logLevel });
const server = await startServer(config);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  log.info('shutting down', { signal });
  try {
    await server.close();
    process.exit(0);
  } catch (err) {
    log.error('shutdown failed', { err });
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  log.error('unhandled rejection', { err: err instanceof Error ? err : new Error(String(err)) });
  process.exit(1);
});
