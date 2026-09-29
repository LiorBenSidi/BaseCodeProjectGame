# Contributing

`main` is protected: nobody pushes to it directly. Every change is a pull request from a branch, and CI
(`checks`, `build`, CodeQL) must be green before it merges.

## Workflow
```bash
git checkout main && git pull
git checkout -b feat/lag-compensation      # feat|fix|test|docs|chore/<thing> (Base Code names its own branches, e.g. base44/..., which is fine)
# 1. change docs/SPEC.md if behaviour changes
# 2. write failing tests           (RED)
# 3. make them pass               (GREEN)
# 4. clean up, tests still green  (REFACTOR, in its own commit)
npm run test:dry      # fast: lint + guard + unit tests (run after every edit)
npm run test:live     # real server: integration, security, system, stress
npm run verify        # dry + live
git push -u origin feat/lag-compensation   # then open a PR
```

## Local gates (mirror CI)
```bash
npm run hooks      # once per clone: pre-commit runs the policy check, pre-push runs all tests
```
Hooks are a safety net; CI is the authority. `--no-verify` is for emergencies only and CI still gates the PR.

## Rules
- **Dry and live tests.** Run both before a PR and say which you ran (`docs/LIVE_TESTING.md`). If live tests cannot run in
  your environment, say "not run", open the PR, and let CI run them. The author verifies first; CI is the second net.
- **Spec, then tests, then code.** Bug fixes start with a test that reproduces the bug.
- **Validate at the boundary.** Any new client message is added to `src/server/protocol.js` with tests,
  including malformed and hostile inputs, before it is used anywhere else.
- **No `console.*` on the server** (use `createLogger`), **no `innerHTML` on the client** (use `textContent`).
  A justified exception needs `// policy-allow: RULE because <reason>` on that line.
- **Layer rule:** `client` and `server` never import each other; both may import `shared`; `shared` imports nothing.
- **No wildcard re-exports.** Keep public surfaces explicit.
- **Refactors are separate commits** with the suite green before and after.
- **Dependencies are a liability.** Prefer the platform. A new dependency needs a reason in the PR, an age
  and CVE check, and a lockfile update.
- Keep PRs small and focused. Squash-merge. Delete the branch afterwards.
- Never commit secrets or `.env*`.

## Commit messages
Imperative, scoped, short: `server: cap input queue at 12 commands`.
