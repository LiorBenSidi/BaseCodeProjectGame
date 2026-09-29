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
