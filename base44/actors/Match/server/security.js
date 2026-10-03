// Trust-boundary helpers. Everything that arrives from a client is an untrusted *source*
// (see docs/SECURITY.md); these functions are the sanitisers that sit before the sinks.

const MAX_NAME_LENGTH = 16;

// Allow-list, not block-list: keep only letters, digits, space, underscore, hyphen.
// NFC composes accents (e + combining acute -> one letter) without rewriting any letter into a different one;
// the allow-list then drops every remaining combining mark, symbol and markup character, so "zalgo" text and
// look-alike angle brackets cannot survive. (NFKC was rejected: it silently changes letters, e.g. script A -> A.)
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
}

// Guards against cross-site WebSocket hijacking: browsers always send Origin on a WebSocket
// handshake and do NOT apply the same-origin policy to it, so the server must check it.
export function isAllowedOrigin(originHeader, hostHeader, allowedOrigins = []) {
  if (typeof originHeader !== 'string' || originHeader === '' || originHeader === 'null') return false;
  let url;
  try {
    url = new URL(originHeader);
  } catch {
    return false;
  }
  if (url.origin === 'null') return false; // file:, data:, sandboxed iframes, extensions...
  const origin = originHeader.toLowerCase();
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin);
  return typeof hostHeader === 'string' && url.host.toLowerCase() === hostHeader.toLowerCase();
}
