// Maps a request URL to a file inside the build directory, or refuses.
// Pure on purpose (no filesystem access): path traversal is the classic sink in a static
// server, so the decision logic is isolated where it can be tested exhaustively.

import path from 'node:path';

export function resolveStaticPath(root, urlPath) {
  if (typeof urlPath !== 'string') return null;

  const bare = urlPath.split('#')[0].split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const rel = decoded === '' || decoded === '/' ? '/index.html' : decoded;
  if (rel.split('/').some((seg) => seg.startsWith('.') && seg !== '..')) return null; // dotfiles
  // '..' segments: resolve, then prove containment below.
  const base = path.resolve(root);
  const resolved = path.resolve(base, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  if (!resolved.startsWith(base + path.sep)) return null;
  // a '..' that stays inside root may resolve, but the *result* must not hit a dotfile either
  const relative = path.relative(base, resolved);
  if (relative.split(path.sep).some((seg) => seg.startsWith('.'))) return null;
  return resolved;
}
