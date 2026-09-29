// Environment parsing. Pure: takes an env-like object, never reads process.env itself,
// so it can be unit-tested and so no other module depends on ambient global state.

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

export function loadConfig(env = {}) {
  const portRaw = env.PORT === undefined || env.PORT === '' ? '3000' : String(env.PORT).trim();
  if (!/^\d+$/.test(portRaw)) throw new Error('Invalid PORT: must be an integer between 1 and 65535');
  const port = Number(portRaw);
  if (port < 1 || port > 65535) throw new Error('Invalid PORT: must be an integer between 1 and 65535');

  const logLevel = env.LOG_LEVEL === undefined || env.LOG_LEVEL === '' ? 'info' : String(env.LOG_LEVEL);
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: must be one of ${LOG_LEVELS.join(', ')}`);
  }

  const allowedOrigins = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    port,
    host: env.HOST ? String(env.HOST) : '0.0.0.0',
    isProd: env.NODE_ENV === 'production',
    allowedOrigins,
    logLevel,
  };
}
