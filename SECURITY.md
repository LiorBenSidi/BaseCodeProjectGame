# Security

## Reporting a vulnerability
Open a private security advisory on the repository (Security tab), or contact the maintainer directly.
Please do not open a public issue for an exploitable bug.

## Threat model
**Assets:** other players' sessions and browsers, server availability, game integrity (fair play).
**Attackers:** any anonymous player with a browser and developer tools; any web page a player visits
while the game is open; a bot that can open many connections.

The security-course framing is used throughout: find every **source** of untrusted data, every dangerous
**sink**, and make sure no path connects them without a sanitiser.

### Sources (untrusted input)
| Source | Where it enters |
|---|---|
| WebSocket frames | `ws.on('message')` in `src/server/server.js` |
| WebSocket handshake headers (`Origin`, `Host`) | `httpServer.on('upgrade')` |
| HTTP request URL / method | `httpServer.on('request')` |
| Player name | `join` message -> stored, sent to *every* client |
| Server messages, as seen by the client | `src/client/net.js` (the server is trusted, but relayed player data is not) |
| Environment variables | `src/server/config.js` (operator-controlled, still validated) |

### Sinks and their controls
| Sink | Risk | Control | Tested in |
|---|---|---|---|
| DOM (scoreboard, kill feed) | Stored XSS via player name (L10) | `sanitizeName` allow-list **and** `textContent` only; `innerHTML` banned by `check-policy.mjs`; prod CSP `script-src 'self'` | `tests/unit/security.test.js`, `tests/security` |
| File system (static server) | Path traversal | `resolveStaticPath`: decode once, reject `..`, NUL, backslash, dotfiles, containment check | `tests/unit/static.test.js` |
| Game state | Cheating: speed hack, teleport, damage spoof | Server-authoritative; clients send intent only; server ignores client `dt`; command budget per tick; replay protection by `seq`; server-side fire-rate | `tests/unit/gameRoom.test.js`, `tests/security` |
| CPU / memory | DoS | 4 KB payload cap (`maxPayload` + parser), per-connection token bucket, per-IP connection cap, protocol-strike disconnect, 16-player room cap, HTTP header/request timeouts | `tests/unit/rateLimit.test.js`, `tests/stress` |
| Logs | Log forging (CWE-117) | JSON-lines logger; newlines in values are escaped | `tests/unit/logger.test.js` |
| WebSocket handshake | Cross-Site WebSocket Hijacking (the CSRF analogue) | `isAllowedOrigin`: browsers do not apply same-origin policy to WebSockets, so `Origin` is checked; missing/`null` origin refused | `tests/unit/security.test.js` |
| Parsers | Prototype pollution, type confusion | Output rebuilt from a whitelist of fields; numbers `Number.isFinite`-checked and clamped; never `Object.assign` from input | `tests/unit/protocol.test.js` |

### Session identifiers
There are no accounts yet. Player ids are small integers that are only meaningful inside one connection,
so nothing grants access by knowing an id. **When accounts or reconnect tokens are added, tokens must be
large random values (>= 128 bits from `crypto.randomBytes`), never sequential**: having the session id
means having the access.

## Automated defences
| Layer | Tool | When |
|---|---|---|
| Lexical static analysis | `scripts/check-policy.mjs` | pre-commit, CI |
| Semantic static analysis (taint tracking) | CodeQL `security-extended` | every PR, weekly |
| Dependency CVEs | `npm audit --audit-level=high`, Dependabot | CI, weekly |
| Adversarial tests | `tests/security/` | pre-push, CI |
| Independent review | blind reviewer writes findings into `docs/HARDENING_REVIEW.md` | each milestone |

## Known and accepted risks
| Risk | Why accepted | Revisit when |
|---|---|---|
| Vite dev server runs with `allowedHosts: true` | Base Code preview hostnames are not known in advance. **Dev only**; production serves built files and applies a strict CSP. | A fixed preview host is known |
| CSP and frame headers are production-only | They would break Vite HMR and the Base Code preview iframe | Preview and prod are separated |
| No lag compensation | Adds complexity; needed for fairness at high latency | Roadmap phase 2 |
| Per-IP limits use the socket address | Behind a reverse proxy every client shares its IP. `X-Forwarded-For` is spoofable, so it is deliberately not trusted | A trusted proxy is configured |
| JSON wire format is larger than binary | Debuggability first | Measured bandwidth problem |
| GitHub Actions pinned to major tags (`@v4`), not commit SHAs | A moving major tag is always "young", so Dependabot's 30-day cooldown can hide a new major (this closed the CodeQL v3-to-v4 PR by itself). Major upgrades of actions are therefore done by hand when release notes announce a deprecation (CodeQL v3 ends Dec 2026). | Before any deploy job is added: pin actions to commit SHAs so Dependabot can propose exact, aged versions |

## Secrets
None are required today. Never commit `.env*`. If a deploy step is added, secrets live in GitHub Actions
secrets only, are injected at runtime, and never appear in the repository, image, or logs. A secret that
was ever committed must be rotated, not merely deleted.

## Base Code preview: Host and Origin differ
In the Base Code preview the sandboxed server sees an internal `Host` while the browser's `Origin` is the public
preview address, so same-origin mode refuses the game's own WebSocket. The fix is to list that single exact origin
in `ALLOWED_ORIGINS` for the preview environment only (the setup passes it through Compose). Never replace the check
with a wildcard, never trust `X-Forwarded-*` headers for this decision, and keep `ALLOWED_ORIGINS` empty in any
environment whose page and socket share a host. Verified with `isAllowedOrigin`: mismatched hosts -> refused; listed
origin -> accepted; other sites and wildcard entries -> refused.
