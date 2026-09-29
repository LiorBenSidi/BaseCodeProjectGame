# AGENTS.md

Instructions for AI coding agents (Base Code's assistant, Claude Code, others) working in this repo.
Read `README.md`, `docs/ARCHITECTURE.md` and `docs/SPEC.md` first.

<!-- OWNER-RULES:BEGIN
Everything between BEGIN and END is maintained by the project owner. Do not edit, reorder, shorten or
remove it. If Base Code's environment setup wants to record findings, it must ADD them in a separate
section named "Environment notes (auto-generated)" AFTER the END marker. `npm run lint` fails if this
region loses its markers or any of its invariants (see scripts/check-agents-md.mjs). -->

## Invariants: do not break these
1. **The server is authoritative.** Clients send intent (commands, shoot). Never add a message where a
   client reports a position, health, damage, or a hit.
2. **`src/shared` is the deterministic simulation core.** No imports from `src/server` or `src/client`, no
   I/O, no `Date.now`, no `Math.random`. Changing it changes gameplay for both sides; update
   `docs/SPEC.md` and the tests in the same PR. Its public surface is fixed by ADR 0001.
3. **All client input passes through `parseClientMessage`** (`src/server/protocol.js`). Add new message
   types there, whitelisting fields, with tests for hostile input.
4. **One port.** HTTP, WebSocket and the client are served by the same server. Do not add a second listener.
5. **No `console.*` in `src/server` or `src/shared`** (use `createLogger`); **no `innerHTML`,
   `insertAdjacentHTML`, `document.write`, `eval`** anywhere. `npm run lint` enforces it.
6. **Everything from another player is untrusted**, including names shown in the DOM. Use `textContent`.
7. **Keep `GameRoom` free of I/O and clocks.** Inject `now` and `random`; drive it with `tick()`.

## How to work
- **Spec -> tests -> code.** Update `docs/SPEC.md`, write failing tests in the right `tests/<type>/`
  directory, then implement. Do not write the only tests for code you just wrote; have them derived from the spec.
- Run `npm run verify` before declaring anything done. Report failures honestly; never comment out or
  weaken a test to make it pass.
- **Dry tests and live tests.** Dry (`npm run test:dry`: lint, guard, unit) after every edit. Live (`npm run test:live`,
  and `npm run smoke <url>` against a running server or preview) before a PR and after any networking, config, header or
  environment change. First find out which you can actually run here. A live suite that did not run is "not run", never
  "passed"; if live tests cannot run, open the PR and let CI run them. Report `Dry: ... / Live: ... / Smoke: ...` in every
  PR. Details and troubleshooting: `docs/LIVE_TESTING.md`.
- **The author verifies.** Run dry and live yourself before saying done; CI is the second net, not the first. For a bug,
  write the test that fails for that bug first, confirm it fails for the right reason, then fix.
- A refactor changes structure, not behaviour, and gets its own commit.
- Do not add dependencies without asking; the project intentionally has three (`three`, `ws`, `vite`).
- Do not commit, push, or open PRs unless asked. Never touch secrets.

## Where things live
| Task | Go to |
|---|---|
| Change a game rule | `docs/SPEC.md` then `src/server/GameRoom.js` / `src/shared/*` |
| New network message | `src/server/protocol.js`, `src/server/server.js`, `src/client/net.js`/`game.js` |
| Security decision | `SECURITY.md` (update the threat-model tables) |
| Test strategy | `docs/TESTING.md` |
| Future plans | `docs/ROADMAP.md`, `docs/adr/` |

## Status
Phase 0 (foundation) - see `docs/ROADMAP.md`. Build within the current phase; do not redo built parts.

## Design decisions: ask, never assume
Story, gameplay rules, look, audio, modes, economy, legal and scope are **the owner's decisions**. Before
building anything that depends on one, check `docs/DESIGN.md`. If it is not recorded there, stop and interview
the owner using `docs/DESIGN_QUESTIONS.md` (Discuss mode, 4-6 questions at a time, options plus a
recommendation), then record the confirmed answer as a dated decision. Cite decision IDs in specs, tests and PRs.

## Using Base Code well
One task = one branch (small commits, every AI chat change is pushed). Open a PR through the chat, let CI gate it,
merge on GitHub. Use Discuss mode to plan, Build mode to implement. Use a different model to review than to build.
Secrets go in Dashboard > Secrets, never in the repo. Full workflow: `docs/BASE_CODE_PROMPTS.md`.
Base Code names its own working branches (for example `base44/...`); that is expected and allowed.

<!-- OWNER-RULES:END -->

## Environment notes (auto-generated)
_Reserved for Base Code's environment setup. Add only non-obvious environment findings here (how the app boots,
required secrets by name, ports). Never put rules or game decisions here._
