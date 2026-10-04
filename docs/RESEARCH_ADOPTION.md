# Research adoption map

Two read-only research passes ran on 2026-10-05 (reports kept outside the repo): professional game references
(BO6, CS2, Valve networking notes, Game Accessibility Guidelines, ioquake3 and other open source shooters) and
Lior's own repositories (work-smarter-not-harder as the E2E standard). This page maps every recommendation to
where it lives in the game, or why it waits.

## Game references (16 items)

| # | Recommendation | Status | Where |
| --- | --- | --- | --- |
| 1 | Telemetry overlay: fps, ping, jitter, loss | Done | SPEC 36.1, `src/client/telemetry.js` |
| 2 | RGB crosshair picker and share codes | Partial | 5 styles, 6 colours, gap / size / thickness / outline (SPEC 33.4); RGB and share codes: ROADMAP |
| 3 | Pre-match countdown and freeze | Done | SPEC 34.1 intro phase (5 s) |
| 4 | Victory ceremony and MVP | Done | SPEC 34.2 podium, MVP, medal totals |
| 5 | Post-match map vote | Done | SPEC 34.4 |
| 6 | Medal pop-ups with stings | Done | SPEC 34.3 + `medal` cue (SPEC 35.1) |
| 7 | Night mode compression | Done | SPEC 36.2 `MIXES` |
| 8 | Practice range | Done | SPEC 35.3 + tutorial 35.4 |
| 9 | High contrast enemy outline | Deferred | ROADMAP (needs an outline pass in post.js) |
| 10 | Minimap with team dots and shot pings | Done | SPEC 34.6 |
| 11 | Kill cam | Done | SPEC 34.5 |
| 12 | Stick response curves | Done | SPEC 36.3 |
| 13 | Inner and outer deadzones | Done | SPEC 36.3 |
| 14 | Render scale | Done | SPEC 36.4 |
| 15 | FPS cap | Done | SPEC 36.4 |
| 16 | Server side occlusion culling | Deferred | ROADMAP, L effort, needs a visibility pass in GameRoom snapshots |

## Lior's repositories (15 items)

| # | Recommendation | Status | Where |
| --- | --- | --- | --- |
| 1 | Batch milestone report | Done | docs/PRO_BATCH_REPORTS.md (P1 to P6), docs/DESIGN.md decisions |
| 2 | Getting started guide | Already covered | README "Quick start" and "Commands" |
| 3 | Secrets and env documentation | Done | `.env.example` (every variable config.js validates) plus README "Running on Base44" |
| 4 | Git hooks installer | Already covered | `scripts/setup-hooks.sh` |
| 5 | README architecture diagram | Already covered | docs/ARCHITECTURE.md |
| 6 | Demo runbook | Already covered | docs/LIVE_TESTING.md, `npm run actor-probe` |
| 7 | Dependency audit | Already covered | `npm run audit:deps` in CI |
| 8 | Node version matrix | Deferred | CI runs Node 22 (the deploy target); a matrix doubles minutes for no deploy benefit |
| 9 | Test suite by category | Done | unit / integration / system / security / stress, plus regression and latency added (SPEC 36.7) |
| 10 | Scaling report | Done | SPEC 36.5 measured 8 and 24 clients; tick budget test keeps it honest (SPEC 36.7) |
| 11 | Production compose | Not applicable | production is the Base44 actor, not a container |
| 12 | Hardening tracker | Already covered | docs/HARDENING_REVIEW.md, SECURITY.md |
| 13 | Seed script | Deferred | persistence is three entities written by the actor; seed when a leaderboard page needs fixtures |
| 14 | ADR index | Already covered | docs/adr |
| 15 | Configurable logging | Already covered | LOG_LEVEL in `config.js`, `src/server/logger.js` |

## Recurring conventions from the homework repositories

| Convention | Status | Where |
| --- | --- | --- |
| Tests categorised by scope (Unit, Integration, System, Security, Regression, Latency) | Done | tests/<suite>, SPEC 36.7 |
| Operational tooling in dedicated folders | Already covered | scripts/, base44/tools/ |
| Root AI and developer guidance (CLAUDE.md, AGENTS.md, CONTRIBUTING.md) | Done | CLAUDE.md added, AGENTS.md and CONTRIBUTING.md existed |
| Deliverable tracking documents | Already covered | docs/SPEC.md, docs/DESIGN.md, docs/ROADMAP.md, docs/PRO_BATCH_REPORTS.md |
| Contract, parity, regression and latency testing | Done | tests/regression, tests/latency |
| Environment template and lockfile discipline | Done | `.env.example`, package-lock.json with `npm ci` in CI |

## Smaller game reference items

| Item | Status |
| --- | --- |
| Settings search bar (CS2 / BO6) | Done, SPEC 36.6 |
| Hold / toggle for ADS, crouch, sprint | Done in P4 (SPEC 33.2) |
| Per zoom sensitivity | Done in P3 (ADS sensitivity multiplier, SPEC 32.4) |
| Tooltips with visual previews | Deferred (crosshair preview exists) |
| Subtitles | Not applicable (no voice lines) |
