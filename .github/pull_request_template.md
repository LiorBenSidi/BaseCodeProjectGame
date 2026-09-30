## What & why
<!-- What changes, and why. Link the issue / spec section. -->

## Design decisions this depends on
<!-- IDs from docs/DESIGN.md (D-001, ...). If a needed decision is missing, stop and ask the owner. -->

## How
<!-- Key decisions worth a reviewer's attention. -->

## Tests (write them first: RED -> GREEN -> REFACTOR)
- [ ] Unit
- [ ] Integration
- [ ] System
- [ ] Security (adversarial / negative inputs)
- [ ] Stress (only if the change affects load behaviour)
<!-- Report honestly. A live suite that did not run is "not run", never "passed" (see docs/LIVE_TESTING.md). -->
```
Dry:   PASS/FAIL - lint, AGENTS.md guard, N unit tests
Live:  PASS/FAIL - integration N, security N, system N, stress N   |   NOT RUN locally: <reason>; CI: <status>
Smoke: PASS against the preview (never paste its URL)   |   not applicable
```

## Checklist
- [ ] `docs/SPEC.md` updated first if behaviour changed (spec -> tests -> code)
- [ ] Dry checks green locally; live checks green, or reported NOT RUN with CI as the check
- [ ] Every new client message is validated in `src/server/protocol.js`
- [ ] No `console.*` in server code, no `innerHTML` in client code
- [ ] No secrets committed; new env vars documented in the README
- [ ] New dependency? Audited (age, CVEs) and justified in the PR
- [ ] Refactors are in their own commit, with tests green before and after
- [ ] Branch is Base Code's own (`base44/...`) or `feat|fix|test|docs|chore/...`; merging via this PR, never pushed to `main`
- [ ] `AGENTS.md` owner rules untouched (`npm run lint` checks this); any setup findings are in its "Environment notes" section
