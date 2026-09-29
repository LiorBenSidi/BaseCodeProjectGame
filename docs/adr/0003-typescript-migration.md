# ADR 0003: Migrate to TypeScript (types-only, no build step)

**Status:** planned. Start only after the test suites (unit, integration, security, system, stress) are merged and green.

## Why
- The wire protocol and the simulation state are the two things most likely to break silently as the game
  grows. Types make "wrong field name / missing field / wrong unit" a compile-time error instead of a
  desync at 2 a.m.
- One language across `shared`, `server` and `client` keeps the shared simulation core shareable (ADR 0001).
- Readability: message shapes, the `Player` state and the `GameRoom` API become self-documenting.

## Decision
1. **TypeScript with erasable syntax only.** Node strips the types at load time, so there is **no build step for
   the server** and no compiled output to keep in sync. Vite already understands `.ts` for the client.
2. **`tsc --noEmit` is the type checker**, run in `npm run verify`, the pre-push hook, and CI.
3. **No enums, namespaces or constructor parameter properties** (they need code generation). Enforced by
   `erasableSyntaxOnly` in `tsconfig.json`. Use string-literal unions and `as const` objects.
4. **A shared, types-only module** (`src/shared/types.ts`) defines every client->server and server->client
   message as a discriminated union, plus `PlayerState`, `Cmd`, `Snapshot`. Erased at runtime, imported by both
   sides, so a protocol change cannot compile on one side and not the other.
5. Runtime validation stays. Types do not validate untrusted input: `parseClientMessage` remains the
   only door, and its return type is what the rest of the server trusts.

Rejected: a `tsc` emit step (adds a second copy of the code to run and debug, and breaks "tests import the
source"); rewriting in another language (see the language discussion: loses shared client/server simulation).

## Constraints to verify in Phase 0 (do not assume)
| Assumption | How to verify |
|---|---|
| Node type stripping is on by default in the Node version Base Code provides (needs >= 22.18; local is 26) | Spike: run a `.ts` file with `node` in Base Code's terminal; if it needs a flag, use `--experimental-strip-types` in the scripts |
| Stripping prints an `ExperimentalWarning` on some versions | If so, add `--disable-warning=ExperimentalWarning` in the npm scripts |
| Relative imports must use the real `.ts` extension | Enable `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` is NOT used |
| `three` needs separate type definitions | Audit `@types/three` (see dependencies) |

## Dependencies (dev-only, nothing ships to players)
Each must pass the age (>= 30 days) and CVE audit, be pinned exactly, and be approved by the owner before install:
`typescript`, `@types/node`, `@types/ws`, `@types/three`. Runtime dependencies stay at three.
Node's version floor in `engines` rises to the verified minimum.

## Plan
Every phase is a **refactor**: behaviour does not change, tests run before and after, one PR each, and the
suites are the safety net. If a phase turns a green test red, the phase is wrong, not the test.

### Phase 0: prove it works (no source changes)
- Install approved dev dependencies. Add `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`,
  `noEmit`, `module: nodenext`, `checkJs: true` with `include: ["src", "scripts", "tests"]`.
- Add `npm run typecheck` and put it in `verify`, the pre-push hook and CI (`checks` job).
- Run the spike above in **both** the local terminal and Base Code. Record results in this ADR.
- **Exit:** `typecheck` runs on the existing `.js` files (errors are fixed with JSDoc types or listed as tracked
  exceptions), 480+ tests still pass.

### Phase 1: types first, still `.js`
- Add `src/shared/types.ts` (types only) and import it into the `.js` files with JSDoc `@typedef`/`import()`.
- Fix everything `checkJs` reports. This finds the real bugs before any rename.
- **Exit:** `typecheck` clean with `checkJs`; no behaviour change.

### Phase 2: rename leaf-first (one PR per group, `git mv` so history follows)
1. `src/shared/`: `constants`, `map`, `hitscan`, `movement`
2. `src/server/` pure modules: `config`, `security`, `rateLimit`, `logger`, `static`, `protocol`
3. `src/server/GameRoom`
4. `src/server/server`, `index`
5. `src/client/*`, `vite.config`
- In each group: rename the files, fix the relative import specifiers (`./x.js` -> `./x.ts`) in source **and in the
  tests that import them**, run the suites.
- **Test-file rule:** a script (`scripts/check-test-diff`) verifies the tests changed **only on import lines**. Any
  changed assertion fails the phase, because the tests are the conformance contract (ADR 0001).
- **Exit per group:** all suites green, `typecheck` clean, `git diff` of tests is import lines only.

### Phase 3: tighten
- Turn on `noImplicitOverride`, `noPropertyAccessFromIndexSignature`. Replace remaining `unknown`/casts at the
  boundaries with narrowing (`parseClientMessage` returns the discriminated union).
- Policy checker: extend `scripts/check-policy.mjs` to scan `.ts`, and add rules `NO_TS_IGNORE`
  (`@ts-ignore` banned; `@ts-expect-error` needs a reason) and `NO_EXPLICIT_ANY`. Update **SPEC section 13
  first**, and let the independent test writer add the tests (spec -> tests -> code).
- `scripts/run-tests.mjs` collects `*.test.ts` as well as `*.test.js`.
- **Exit:** zero `any` and zero `@ts-ignore` in `src/`; policy tests cover the new rules.

### Phase 4: tests and scripts
- Convert tests to `.ts` last (typed helpers catch wrong message shapes in tests too). Same import-lines-only rule.
- `scripts/*.mjs` may stay JavaScript with `// @ts-check`; convert only if worthwhile.

### Phase 5: cleanup
- CodeQL already analyses TypeScript (`javascript-typescript`). Confirm it still passes.
- Update `README`, `CONTRIBUTING`, `AGENTS.md`, `docs/ARCHITECTURE.md` file extensions; add the docs-contract test
  from `docs/TESTING.md` if not yet done.

## Rollback
Each phase is one revertible PR. Because there is no build output, reverting leaves the tree runnable.

## Definition of done
`npm run verify` (policy + typecheck + all suites) and CI (`checks`, `build`, CodeQL) green; production smoke
test in the `build` job passes; no test assertions changed; no new runtime dependencies.
