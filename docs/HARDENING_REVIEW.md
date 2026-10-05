# Adversarial hardening review

The record of independent security reviews. Each review is done by a reviewer who has **not** read the tests
(a different person or AI model than the one that wrote the code), so findings are fresh. Every finding gets a
severity and a status, and every fixed finding gets a test that fails without the fix.

## How to run a review
1. Reviewer reads `src/` and `SECURITY.md` only.
2. Reviewer lists concrete vulnerabilities with severity and a reproduction, and lists what was checked and found clean.
3. For each finding: add a failing test first, then fix, then mark it Fixed with the test's path.

## Status values
`Open` - `Fixed` (with test) - `Accepted` (with rationale and a revisit trigger, mirrored in `SECURITY.md`) - `Not a bug`.

## Reviews
| Date | Reviewer (person / model) | Scope | Result |
|---|---|---|---|
| 2026-09-29 | Independent spec-first test authors (AI agents that never read `src/`) | All server modules, HTTP/WebSocket layer, static serving, policy checker | 3 defects found and fixed (below); all 5 suites green |
| 2026-10-05 | GitHub Advanced Security (CodeQL default setup, 103 JS rules) on PR #35 and #38, plus a manual pass (npm audit, tracked secrets, DOM sinks, server input limits, CI permissions) | `scripts/smoke-browser.mjs`, repo settings, client text sinks, server protocol limits | 3 CodeQL findings fixed, 1 dismissed as test-harness design (below); Dependabot security updates enabled 2026-10-05 |

## Findings
| ID | Severity | Finding | Status | Test / rationale |
|---|---|---|---|---|
| H-001 | Low | `POST/PUT/DELETE/PATCH/OPTIONS` to `/healthz` and `/readyz` returned `200` instead of `405`: the health paths were matched before the HTTP method was checked. | Fixed | `tests/integration/http.test.js` ("... on any path is 405 with Allow: GET, HEAD", dev and prod) |
| H-002 | Low | `sanitizeName` used Unicode NFKC normalisation, which silently rewrote letters into different letters (script "A" became "A"), an undocumented behaviour. Switched to NFC; rule written into `docs/SPEC.md` section 6. | Fixed | `tests/security/input-validation.test.js` ("the 16 character limit counts code points, not UTF-16 units") |
| H-003 | Low | `NO_HARDCODED_SECRET` in the policy checker only matched identifiers that *start* with a keyword, so `authtoken = "..."` was missed. | Fixed | `tests/unit/policy.test.js` (secret rule, identifier merely containing the word) |
| H-004 | Info (CodeQL rated High) | CodeQL `js/incomplete-url-substring-sanitization` at `tests/unit/policy.test.js:409`: a unit test asserts that the comment-stripper leaves a sample `http://x.y` intact. No URL is validated or trusted. | Not a bug (alert #1 dismissed on GitHub as "Used in tests", 2026-09-29) | Test fixture only; never shipped |
| H-005 | High | CodeQL `js/insecure-temporary-file`: the headless smoke driver wrote screenshots to a fixed, predictable `/tmp/smoke/<name>.png`. | Fixed (PR #38) | Each run now uses `fs.mkdtempSync(os.tmpdir()/smoke-, 0700)`, files 0600, screenshot names restricted to `[A-Za-z0-9_-]{1,64}`. |
| H-006 | Medium | CodeQL `js/log-injection` (alerts 4 and 5): step names, eval results and page console lines reached `console.log` unfiltered. | Fixed (PR #38) | `clean()` strips `\r`, `\n` and all control characters and truncates; page console lines are JSON-quoted. |
| H-007 | Medium | CodeQL `js/file-access-to-http`: the step file could carry any URL into `Page.navigate` and any expression into `Runtime.evaluate`. | Mitigated, alert dismissed "used in tests" | Step file must be a `.json` inside `docs/smoke/`; `goto` is a relative path validated by an allow-list regex and resolved against the argv base URL (http/https only). The eval expressions of the versioned step files reaching the DevTools socket is the harness's purpose; the driver is dev-only and never shipped. |

## Checked and found clean
_Fill in per review: what was examined and held up._

### 2026-10-05
- `npm audit` (prod and dev): 0 vulnerabilities. Dependabot alerts: 0. Secret scanning: 0 alerts, push protection on.
- Tracked files: no secrets; only `.env.example`. No `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function` or `document.write` in `src/`; player text reaches the DOM through `textContent` only (policy test enforces it).
- Server trust boundary: names sanitized (`sanitizeName`, max 16, letters/digits/space/_/-), chat text capped at 400 chars in `protocol.js`, input queue capped (`MAX_QUEUE` 12, `MAX_CMDS_PER_TICK` 4), `ALLOWED_ORIGINS` enforced.
- CI: `permissions: contents: read`; actions pinned to major tags (`actions/checkout@v7`, `actions/setup-node@v7`, `github/codeql-action@v4`).
