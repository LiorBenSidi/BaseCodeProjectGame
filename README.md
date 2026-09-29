# Base Code Arena

A multiplayer 3D first-person shooter: an **authoritative Node.js server** (WebSocket) and a **Three.js
client**, served from a single port. Built to be imported into Base Code and grown for the long term.

- Server-authoritative simulation, client-side prediction and reconciliation, snapshot interpolation
- Every network message validated at one choke point; rate limits and DoS controls
- Layered test suite written spec-first; CI, CodeQL and dependency audit on every PR
- Simulation core isolated so it can later be replaced by C++/WebAssembly (see `docs/adr/0001-...`)

## Quick start
```bash
npm install          # first time: also generates package-lock.json (commit it; CI uses `npm ci`)
npm run dev          # http://localhost:3000  (PORT env var to change)
```
Open it in two browser windows and press Play in each. Controls: WASD, Space, mouse, click to shoot, Tab
scoreboard, Esc to release the mouse.

## Commands
| Command | Does |
|---|---|
| `npm run dev` | server + Vite dev middleware + HMR on one port |
| `npm run build` / `npm start` | production build / serve it with a strict CSP |
| `npm run lint` | syntax + security-pattern policy check |
| `npm test` (or `test:unit`, `:integration`, `:system`, `:security`, `:stress`) | test suites |
| `npm run test:dry` | fast, no server: lint + `AGENTS.md` guard + unit tests |
| `npm run test:live` | real server: integration + security + system + stress |
| `npm run smoke <url>` | live smoke check of a running server or preview URL |
| `npm run verify` | lint + all tests (what CI and the pre-push hook run) |
| `npm run coverage` | built-in coverage report |
| `npm run audit:deps` | known-CVE scan of dependencies |

## Importing into Base Code
1. Push this repository to GitHub (project root = repo root; Base Code does not support monorepo subfolders).
2. In Base Code, connect the repository or paste its URL.
3. Run `npm install` and `npm run dev` in its environment and open the preview.

Base Code is a **development preview**, not production hosting; see `docs/ROADMAP.md` phase 6.
Base Code does not add Base44 entities or the SDK to an imported repository, so the project is self-contained.

## Repository map
```
src/shared/   deterministic simulation core (constants, map, movement, hit-scan)
src/server/   GameRoom (pure rules), protocol/security/rateLimit/config/logger/static, server.js (I/O)
src/client/   Three.js scene, input, prediction, HUD
tests/        unit, integration, system, security, stress
docs/         SPEC (the contract), ARCHITECTURE, TESTING, ROADMAP, adr/
scripts/      check-policy.mjs, run-tests.mjs
.github/      CI, CodeQL, Dependabot, PR template
```

## Read next
`docs/SPEC.md` -> `docs/ARCHITECTURE.md` -> `docs/TESTING.md` -> `docs/LIVE_TESTING.md` -> `SECURITY.md` -> `CONTRIBUTING.md`.
For AI coding agents (including Base Code's assistant): `AGENTS.md`.
