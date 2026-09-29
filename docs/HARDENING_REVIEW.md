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

## Findings
| ID | Severity | Finding | Status | Test / rationale |
|---|---|---|---|---|
| H-001 | Low | `POST/PUT/DELETE/PATCH/OPTIONS` to `/healthz` and `/readyz` returned `200` instead of `405`: the health paths were matched before the HTTP method was checked. | Fixed | `tests/integration/http.test.js` ("... on any path is 405 with Allow: GET, HEAD", dev and prod) |
| H-002 | Low | `sanitizeName` used Unicode NFKC normalisation, which silently rewrote letters into different letters (script "A" became "A"), an undocumented behaviour. Switched to NFC; rule written into `docs/SPEC.md` section 6. | Fixed | `tests/security/input-validation.test.js` ("the 16 character limit counts code points, not UTF-16 units") |
| H-003 | Low | `NO_HARDCODED_SECRET` in the policy checker only matched identifiers that *start* with a keyword, so `authtoken = "..."` was missed. | Fixed | `tests/unit/policy.test.js` (secret rule, identifier merely containing the word) |
| H-004 | Info (CodeQL rated High) | CodeQL `js/incomplete-url-substring-sanitization` at `tests/unit/policy.test.js:409`: a unit test asserts that the comment-stripper leaves a sample `http://x.y` intact. No URL is validated or trusted. | Not a bug (alert #1 dismissed on GitHub as "Used in tests", 2026-09-29) | Test fixture only; never shipped |

## Checked and found clean
_Fill in per review: what was examined and held up._
