# Testing strategy

## Principles
1. **Spec first.** `docs/SPEC.md` is the contract. Order of work: spec -> failing tests (RED) -> code (GREEN)
   -> refactor. A bug fix starts with a test that reproduces the bug.
2. **The author of the code does not write its only tests.** Tests for new modules are written from the spec
   by someone (or an independent agent) who has not read the implementation. The author adds edge cases
   afterwards, never in place of that.
3. **One behaviour per test**, named for the behaviour. Test behaviour, not mechanism: never recompute the
   expected value with the same formula the code uses.
4. **Tests are independent and deterministic.** No sleeps, no real clocks, no shared state. Inject `now` and
   `random`. Anything flaky is investigated immediately, not retried.
5. **A broken test is fixed or deleted, never commented out.**
6. **Zero collected tests is a failure** (`scripts/run-tests.mjs`), so a misconfigured glob cannot go green.
7. **Refactor only under green tests, in its own commit.** Refactoring changes structure, not behaviour.

## Layout (one directory per test type)
| Directory | What it proves | Example |
|---|---|---|
| `tests/unit/` | One module in isolation, no sockets | movement collides with walls; parser rejects `NaN` |
| `tests/integration/` | Modules wired together over a real socket | join -> welcome -> snapshot ack advances |
| `tests/system/` | The whole product as a player sees it (production build, headers, static files) | `/` serves the client with a CSP |
| `tests/security/` | Adversarial behaviour against the running server | foreign `Origin` refused; flood closes the socket |
| `tests/stress/` | Behaviour under load (run on demand) | 16 clients at 60 Hz keep the tick under budget |

## Feature x test-type matrix
| Feature | Unit | Integration | System | Security | Stress |
|---|:-:|:-:|:-:|:-:|:-:|
| Movement + collision | x | x | | | |
| Hit-scan + damage + respawn | x | x | | x | |
| Protocol validation | x | | | x | |
| Rate limiting / DoS controls | x | | | x | x |
| Static file serving | x | | x | x | |
| Config + logging | x | | | x | |
| Prediction / reconciliation determinism | x | x | | | |
| Hit zones + range bands (D-010, D-011, D-014) | x | x | | | |
| Grenade flight, fuse, blast, cover (D-012, D-015) | x | x | | x | |
| Combat log + verdict feedback (D-013) | x | x | | | |
| Snapshot size with grenades | x | | | | |
| Touch stick, look, rotate prompt (D-016) | x | | | | |

### Combat test files
- `tests/unit/combat.test.js`: every zone, band boundaries at exactly 20/40/120 m, misses, `applyDamage`.
- `tests/unit/projectile.test.js`: arc, bounce, floor, fuse at 30/60/120 Hz, falloff, cover.
- `tests/unit/gameRoomCombat.test.js`: verdicts, throws, self-damage, cover, snapshot `nades` and size.
- `tests/unit/combatLog.test.js`: bounded log, head/body markers, formatting from server-shaped messages.
- `tests/integration/combat-flow.test.js`: verdict and grenade replication over a real socket.
- `tests/security/input-validation.test.js`: hostile `throw` messages.

Baseline note: a level eye-height shot at 4 m is a **head** hit (25 × 1.5 = 37.5), so the pre-existing
shooting tests assert 37.5 per hit and three hits to kill; their obstruction/cooldown/respawn logic is unchanged.

### Debug harness (manual check, not an automated suite)
Embedded previews refuse pointer lock, so aiming, firing and throwing cannot be driven by the mouse there.
Open the game with `?debug=1`, join, and use the on-screen debug panel or the console:
`__arenaDebug.aim(yaw, pitch)`, `__arenaDebug.fire()`, `__arenaDebug.throwGrenade()`, `__arenaDebug.state()`.
These send the same `input`/`shoot`/`throw` intents as real controls; the server decides every result.
Record what you saw (verdict, combat log line, grenade arc and explosion) in the PR.

## Base44 transport (section 17)
| Area | Unit | Live |
|---|---|---|
| `MatchSession` budgets, strikes, join, room full, rejoin | `tests/unit/matchSession.test.js` | `tests/integration`, `tests/security` through `server.js` |
| `MatchHost` wake / close codes / ticker gate | `tests/unit/matchHost.test.js` | manual two-tab check on the deployed room (LIVE_TESTING.md) |
| Actor folder in sync with `src/`, CFW import rules | `tests/unit/actorBundle.test.js` | `npx base44 actors deploy` (the bundler is the final judge) |
| Client room id / connection id helpers | `tests/unit/netActor.test.js` | manual reload check |

## Docs stay true (planned contract test)
Docs drift silently (an observed example: a project README describing one framework while `package.json` used
another). Add `tests/system/docs-contract.test.js`: every `npm run <x>` mentioned in README/CONTRIBUTING must exist
in `package.json` scripts, and every env var in `docs/ARCHITECTURE.md` must be read by `src/server/config.js`.

## Running
```bash
npm run verify        # lint + every suite (this is what the pre-push hook and CI run)
npm run test:unit     # one suite
npm run coverage      # node's built-in coverage, no extra dependency
```

## Mutation check (does the suite actually catch regressions?)
Before merging non-trivial logic, apply a handful of one-line mutations to the implementation (flip a `>=`
to `>`, empty an allow-list, remove a clamp) and confirm each is caught by at least one test. A mutation that
survives is a coverage gap. Record the result in the PR.

## Regression, contract and latency suites (SPEC 36.7, D-034)

| Suite | Command | Guards |
| --- | --- | --- |
| regression | `npm run test:regression` | Protocol contract invariants (both dispatchers, client handlers, actor mirror parity) and gameplay baselines (weapons, match flow, bots, defaults) |
| latency | `npm run test:latency` | Tick budget: 16 seat room, 600 ticks, p99 under 6 ms |

Changing a baseline on purpose: edit the number in the test and the matching line in docs/SPEC.md in the same commit.

CI wiring (owner step: the agent's GitHub token has no `workflow` scope, so this edit to `.github/workflows/ci.yml` is applied by hand). Add after the "Unit tests" step in the `checks` job:

```yaml
      - name: Regression baselines and contract invariants
        run: npm run test:regression
      - name: Latency budget (tick p99)
        run: npm run test:latency
```

## Browser smoke run (SPEC 36.8)

```bash
PORT=8820 ALLOWED_ORIGINS=http://localhost:8820 NODE_ENV=production node src/server/index.js &
node scripts/smoke-browser.mjs docs/smoke/settings.json
node scripts/smoke-browser.mjs docs/smoke/deathmatch.json
node scripts/smoke-browser.mjs docs/smoke/range-tutorial.json https://<live host>   # actor only
```
Each step prints a JSON line of what it read from the page; screenshots land in /tmp/smoke. Needs google-chrome.
