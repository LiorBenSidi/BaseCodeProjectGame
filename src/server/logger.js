// Structured, named, levelled logger. One JSON object per line.
// JSON encoding is also the log-forging defence (CWE-117): a newline inside a value becomes
// the two characters "\n", so an attacker-controlled string cannot fake a second log entry.
// This is the only sanctioned output path for server code; `console.*` is banned by
// scripts/check-policy.mjs.

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const RESERVED = new Set(['ts', 'level', 'logger', 'msg']);

const defaultSink = (line) => process.stdout.write(`${line}\n`);

// JSON leaves the Unicode line/paragraph separators unescaped, and several log pipelines treat
// them as line breaks. Built with fromCharCode so this file contains no invisible characters.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const escapeSeparators = (s) => s.split(LINE_SEPARATOR).join('\\u2028').split(PARAGRAPH_SEPARATOR).join('\\u2029');

export function createLogger(name, { level = 'info', sink = defaultSink, now = () => new Date() } = {}) {
  if (!Object.hasOwn(ORDER, level)) throw new RangeError('Unknown log level');
  const min = ORDER[level];

  const emit = (lvl) => (msg, fields) => {
    if (ORDER[lvl] < min) return;
    const extra = {};
    if (fields && typeof fields === 'object') {
      for (const [k, v] of Object.entries(fields)) {
        if (RESERVED.has(k)) continue;
        extra[k] = k === 'err' && v instanceof Error ? { name: v.name, message: v.message } : v;
      }
    }
    let line;
    try {
      line = JSON.stringify({ ts: now().toISOString(), level: lvl, logger: name, msg: String(msg), ...extra });
    } catch {
      // circular structures / BigInt: never let logging take the process down
      line = JSON.stringify({ ts: now().toISOString(), level: lvl, logger: name, msg: String(msg), logError: 'unserialisable fields' });
    }
    sink(escapeSeparators(line));
  };

  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
