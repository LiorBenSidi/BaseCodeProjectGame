# CLAUDE.md

Guidance for AI coding tools working in this repository. The authoritative rules live in [AGENTS.md](AGENTS.md);
this file exists so tools that look for CLAUDE.md find the same entry point (the convention from Lior's other
repositories).

- Read AGENTS.md first, then docs/SPEC.md (behaviour), docs/DESIGN.md (decisions D-001 ...), docs/TESTING.md.
- Spec first: a behaviour change updates docs/SPEC.md and its tests in the same commit.
- Run `npm run test:dry` before every commit (lint, unit, regression and contract invariants) and `npm test` before a PR.
- The actor mirror under base44/actors/Match is generated: edit src/, then `node base44/tools/sync-actor.mjs`.
- Production ships by merge to main then Publish; an actor change also needs `base44 actors deploy Match` (D-017, D-026).
- No downloaded assets unless CC0 and listed in docs/ASSETS.md.
