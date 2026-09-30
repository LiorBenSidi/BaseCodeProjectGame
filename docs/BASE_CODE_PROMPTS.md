# Working with Base Code

This repository is the **foundation**. Base Code does the heavy implementation, **and it also helps you decide what
the game should be**: story, gameplay, look, modes, economy, everything left open. It does that by interviewing
you (`docs/DESIGN_QUESTIONS.md`) and recording your answers (`docs/DESIGN.md`) before building anything that
depends on them.

Legend: **[documented]** = stated on the Base Code page (`docs.base44.com/Getting-Started/base-code`, read in full).
**[verify]** = stated elsewhere in the Base44 docs (for example the general "AI chat modes" page) or plausible, but
**not confirmed for Base Code**. Check it in the product and tell the assistant what you find.

## 0. Before you import (checklist)
- [ ] The repository is pushed to GitHub and is a **web or full-stack project at the repository root** (monorepo
      subfolders are not checked as the project) [documented]. This repo qualifies: Node server + browser client.
- [ ] You are an **owner, admin or editor** in the workspace, and your GitHub account has **push access** to the repo
      (otherwise use **Paste a link** to fork or copy) [documented].
- [ ] For a **private** repo, the **Base44 GitHub App** has access to it. If your workspace limits organisations, the
      organisation must be **Allowed** under workspace settings > Build tools > GitHub [documented].
- [ ] `package-lock.json` is committed (CI uses `npm ci`).
- [ ] On GitHub, `main` is protected: require a PR and the `checks`, `build` and CodeQL status checks.
- [ ] Opening PRs needs write access; if Base44 asks for permission, click **Review permissions on GitHub** and have
      the repo (or organisation) owner approve [documented].
- [ ] Connecting a repo does **not** add Base44 entities, login or the SDK; the project keeps its own stack. Anything
      Base44-specific must be added deliberately [documented].
- [ ] **Expect a setup step.** On a repository it has not seen before, Base Code may add environment files of its own
      (for example a container-based dev-environment definition, a `.base44/` folder, and an **`AGENTS.md`**) and offer a
      pull request for them. **We already have an `AGENTS.md`** with the project's invariants: the owner region is marked
      and guarded (`npm run lint`), and Prompt 0 tells the assistant to leave it alone.
- [ ] **Preview basics:** the preview expects the app on **port 3000** and a healthy response at `/`. Our server
      defaults to port 3000, binds `0.0.0.0` and exposes `/healthz`. Cloud sandboxes are short-lived, which is why every
      AI change is committed and pushed; in-memory game state does not survive, and that is expected for a development preview.
- [ ] **WebSocket origin in the preview.** Behind a preview proxy the server can see a different `Host` than the
      browser's page `Origin`, so our same-origin check would answer `403` to the game's own WebSocket (demonstrated
      with `isAllowedOrigin`). The fix is configuration, not code: set `ALLOWED_ORIGINS` to the **exact** preview origin
      for that environment only (never a wildcard). Prompt 0 asks the assistant to find that origin, set it, and confirm `/ws` connects.
- [ ] Vite is started by our own server in middleware mode with `allowedHosts: true` and HMR on the same port, so no
      second HMR port is needed (only one port is exposed).
- [ ] Health checks must use the endpoints that already exist (`/healthz`); the app code must not be changed for them.
- [ ] Main-branch protection: new imported projects start with it **on** (AI chat turns on main go to a working
      branch); it can be turned off in project settings. Keep it on.

---

## 1. The workflow, using Base Code's features

| Step | What to do | Base Code feature |
|---|---|---|
| 1. Decide | Talk the topic through and answer the interview questions. Nothing is built or changed. | **Discuss mode** (asks clarifying questions, changes no code, 0.3 credits per message) per the general AI-chat-modes page [verify it exists in Base Code]. **Fallback if it does not:** stay in the normal chat and start the prompt with "Do NOT change any file; ask questions only." |
| 2. Record | Ask the assistant to write your confirmed answers into `docs/DESIGN.md` and update the spec. | **Build mode** (default; acts immediately, asks no questions) [verify for Base Code] |
| 3. Branch | One task = one branch. Start the first prompt of a task with a short, clear phrase; the branch is named from it. | Prompt box -> **Create branch**; each branch runs in its **own sandbox**; names are generated from your request [documented] |
| 4. Build | Spec, then failing tests, then code. Keep prompts small: every AI chat change is **committed and pushed** to the branch, so small prompts give a readable history. | Auto-commit and push per AI chat change [documented] |
| 5. Prove | Ask for the **dry** run (`npm run test:dry`) after each change and the **live** run (`npm run test:live`, plus `npm run smoke <preview-url>`) before the PR, each reported as PASS / FAIL / NOT RUN with a reason. A terminal is not described in the docs, so where the assistant cannot run live tests, CI on the PR is the live check. | AI chat [documented]; terminal [verify] |
| 6. PR | Ask the chat to "create a pull request" using the PR template (it writes the title and description), or use **Create PR**. Further commits on the branch appear in the same PR, and GitHub runs the repo's configured checks (our `checks`, `build`, CodeQL). Opening a PR does not merge it. | Create PR / chat-created PR; targets the branch yours was created from [documented] |
| 7. Review | Ask the chat for the review comments: it lists each unresolved thread with file and line, drafts a change and a reply for each. You approve each draft before it **posts**, and ask **separately** to resolve a thread. Use a **different AI model** for review than for building. | Review comments; model picker / Auto mode [documented]. Posts appear as `base44-builder[bot]` |
| 8. Conflicts | If GitHub reports a conflict, use **Resolve conflicts** (Base44 merges the base branch into your branch); re-run `verify` after. | [documented] |
| 9. Merge | Merge on GitHub once CI is green (recommended, so branch protection applies). There is no merge button in Base Code, though you can ask the chat to merge. | [documented] |
| 10. Repeat | Delete the branch; start the next task from an up-to-date base. | Deleting a branch in Base Code leaves it on GitHub [documented] |

### Smart habits for this project
- **Interview before building.** For anything in `docs/DESIGN_QUESTIONS.md`, start in Discuss mode. Do not let the
  assistant pick answers for you; every decision it relies on must have an ID in `docs/DESIGN.md`.
- **Branch per topic; parallel where safe.** Independent work (art/content, UI, audio) can live on separate branches
  side by side. Work that touches `src/shared/`, `docs/SPEC.md` or `src/server/protocol.js` goes one branch at a
  time to avoid conflicts. The docs for app branches mention up to 5 parallel builds; **[verify]** the limit in Base Code.
- **Compare two versions for taste decisions.** For look-and-feel choices (HUD style, weapon feel) ask for two
  alternatives and pick one. **[verify]** that the "Option A / Option B" comparison is available in Base Code; if not,
  simulate it with two branches and compare their previews.
- **Choose the model deliberately.** Auto mode for routine edits; a stronger model for netcode and security; a different
  model than the builder for review. Model cost varies **[documented]**.
- **Secrets never go in chat or the repo.** The chat prompts you when one is needed; add it in the app dashboard >
  **Secrets** > **Add Secret**, or bulk-add with **Import .env** (each `KEY=VALUE` line becomes a secret and **overwrites**
  any existing secret with the same name). They are encrypted, kept out of the repository and shared across all
  branches; running branches pick up changes automatically, inactive ones when opened **[documented]**. Document only
  the variable *names* in the README. `PORT`, `HOST` and `LOG_LEVEL` may be set there too. `ALLOWED_ORIGINS` is different: every branch has its own preview address, so it must come from the runtime environment, never from one shared value.
- **Commit before you walk away.** Your project pauses when you stop and, if rebuilt, is **cloned again from the latest
  commit on that branch**; uncommitted work is lost **[documented]**. Since every AI change is committed, this mainly
  means: do not leave manual edits uncommitted.
- **Know what the docs do not say.** They do not describe a terminal, how the preview process is started (command,
  port), undo/history, or WebSocket support in the preview. Prompt 0 makes the assistant find out and report.
- **Protect `main` on GitHub** (you do this in repo settings): require the `checks` and `build` status checks and
  CodeQL, block direct pushes, require a PR.
- **Base Code is a development preview**, not production hosting **[documented]**: release through a separate
  deployment (Prompt 8).
- **Collaboration:** workspace owners, admins and editors can open the project; outsiders join as collaborators
  **[documented]**. Commits appear as the Base44 bot with you as co-author.

---

## 2. Rules to repeat if the assistant drifts
- Read `AGENTS.md` first. Its invariants are non-negotiable.
- **Ask, do not assume.** If anything about design, story, gameplay, art, audio, business, legal or scope is not in
  `docs/DESIGN.md`, stop and ask me (Discuss mode). Ask many questions, in small batches, with options and a recommendation.
- **Spec first, then tests, then code.** Never edit or delete an existing test assertion to make something pass.
- **Dry and live tests, reported honestly** (`docs/LIVE_TESTING.md`). Dry (`npm run test:dry`) after every edit; live
  (`npm run test:live`, `npm run smoke <url>`) before a PR and after any networking, config or environment change. First
  find out which kinds you can run here. Report `Dry: ... / Live: ... / Smoke: ...`. A live suite that did not run is
  "not run", never "passed": open the PR and let CI run it. You verify first; CI is the second net.
- One task, one branch, small commits. Show the diff and the test report before you finish.
- No new dependency without asking me first (I audit each one for age and CVEs).

---

## 3. Prompts (paste one at a time, in order; each ends with the dry checks green and the live checks green, or reported NOT RUN with CI as the check)

Order: **Prompt 0**, then **Prompt 00** (the interview), then **Prompt 01** at each natural break, then **Prompt 1**, then the rest as needed.

### Prompt 0 - Orientation and proof it runs (paste this first)
> Read `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `SECURITY.md`, `docs/LIVE_TESTING.md` and
> `docs/DESIGN.md`. Then do the steps below in order. Report every step as PASS / FAIL / NOT RUN / UNKNOWN with the reason
> (a check you could not run is "not run", never "passed"). Do not change any file until step 7; starting the app and
> setting runtime environment variables in the sandbox are not file changes. You work on a branch, never on `main`: if you
> find yourself on `main`, stop and ask me to create a branch.
> 1. Install exactly the locked dependencies with `npm ci`. Nothing may be added or upgraded; ask me before any other
>    install. Report the Node version; if it is below 22, report FAIL and stop.
> 2. Run the dry checks: `npm run test:dry`.
> 3. Run the live suites: `npm run test:live`. If the environment forbids opening a local port (EPERM / EACCES), report them
>    NOT RUN. CI runs the unit, security, integration and system suites on every pull request; the stress suite runs only
>    on demand.
> 4. Find out how this environment starts the app and which port the preview uses. If a preview is already running, use it:
>    do not start a second server and do not kill processes. Otherwise start `npm run dev` in the background. Report the
>    command, the port, whether `PORT` is set, and whether the preview loads.
> 5. Run `npm run smoke <preview-url>` and report every line. If you can open a browser, also open the preview in two tabs,
>    join in both and confirm each sees the other; if you cannot, report that part NOT RUN and ask me to do it and tell you
>    what I see. If the WebSocket line reports `403`, the cause is the Origin check. Find out how this environment exposes the
>    preview page's origin to the app (an environment variable, or the request itself) and make `ALLOWED_ORIGINS` read exactly
>    that at run time. Never write a literal preview URL into any committed file (the repo is public, every branch has its own
>    preview address, and preview links may grant access). Never use a wildcard, never disable the check. If the platform exposes
>    the origin under a different name, propose the smallest possible mapping (for example one startup line that sets
>    `ALLOWED_ORIGINS` from it) as part of step 7, and until then export it in the shell for testing only. If the environment
>    exposes no such value, stop and ask me.
> 6. Report whether you can run terminal commands and how, and whether Discuss mode exists in this chat.
> 7. If this environment needs dev-environment files of its own (a container definition and so on), first check whether Base Code's own setup already created files or a pull request, and review and reuse those instead of creating a second set. Otherwise propose them as a
>    separate setup branch and pull request, created before you write any file (never write them on the branch you are on): ask me to create the branch (I click Create branch), or create it yourself if you
>    can. Use one service on port 3000 with a health check on `/healthz` that runs `npm ci` and takes `ALLOWED_ORIGINS` from the
>    runtime environment as in step 5. Do not adapt any file of ours as-is: the repo has no Dockerfile or Compose file today.
>    In `AGENTS.md`, never touch the region between `OWNER-RULES:BEGIN` and `OWNER-RULES:END`; add environment findings only
>    under "Environment notes (auto-generated)". Run `npm run lint` before you finish: it fails if the owner region was altered.
> 8. Finish with one table: check | result | evidence, plus a list of anything that failed or was skipped. For this prompt the
>    table replaces the `Dry: / Live: / Smoke:` lines.

### Prompt 00 - The design interview (Discuss mode; paste after Prompt 0)
> You are my game designer and producer. Read `README.md`, `AGENTS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
> `docs/SPEC.md`, `docs/DESIGN_QUESTIONS.md` and `docs/DESIGN.md` (the decision log: never re-ask what is already decided).
> Do not build or change anything during the interview. If Discuss mode does not exist in this chat, tell me and continue in the normal chat, still changing no files. First ask me which language to use for it. Then interview me in
> the order given in "Interview order and tiers" at the top of `docs/DESIGN_QUESTIONS.md`: the tier-1 anchors first, then the
> core design areas, then the rest. Rules:
> 1. Ask 4-6 questions at a time on one topic, never a giant list. For each give 2-4 concrete options, say which you
>    recommend and the trade-off, and always allow "something else".
> 2. Ask a follow-up when my answer opens a new question, and add your own questions about anything that would change the
>    design, but keep each topic short.
> 3. Challenge answers that conflict with each other or with `docs/SPEC.md` or `docs/ARCHITECTURE.md` (for example a
>    time-to-kill the 30 Hz server cannot make fair). Say what it would cost.
> 4. I may answer "park": record it as parked with a sensible default and a trigger to revisit, and move on. For the
>    technical, legal and operations topics (tier 4) offer a recommended default and ask only "accept the default?" unless
>    I want detail.
> 5. After each topic, post a block titled DECISIONS SO FAR listing every confirmed and parked item with a proposed ID
>    (D-nnn), and ask me to confirm or correct it. I will paste Prompt 01 at natural breaks (about every two or three topics)
>    so nothing is lost if this chat pauses.
> 6. Keep a running list of what is still undecided. If I say "you decide", give me your recommendation and the reason and
>    ask me to approve it explicitly.
> 7. If I say "pause", post DECISIONS SO FAR, the undecided list and where to resume, then stop.
> 8. The interview is finished when every tier-1 and tier-2 question is decided or parked; continue into tiers 3 and 4 only
>    if I ask you to.
> Begin with the language question and then the tier-1 anchors. Do not skip topics unless I park them.

### Prompt 01 - Record the decisions (Build mode; `docs/DESIGN.md` is the only file you may change)
> Write every decision and parked item I confirmed in the interview into `docs/DESIGN.md` as dated entries with IDs
> (D-001...), using the template there (status: decided or parked), and update the status table. If any decision changes
> game rules, list the `docs/SPEC.md` sections that must change but do not change them yet. Number each entry with the next
> free D-number after the highest one in the file (proposed numbers from the chat may be renumbered; never reuse one). Put this
> change on its own small branch and open a pull request, and I will merge it before the next task, so every new branch starts
> from the current log. Show me the diff.

### Prompt 1 - Close the spec gaps found by independent review
> `docs/SPEC.md` section 14 lists every ambiguity found by the independent test authors, with the behaviour the code has
> today. Resolve each item: state the current behaviour, propose a decision, and ask me before deciding anything that
> changes gameplay or security posture. Then record the decision in `docs/DESIGN.md`, write it into the spec, add or adjust
> tests (spec first, tests before code), and change the code only if the decision differs from today's behaviour. Work in
> small groups, one branch each, and mark each resolved item in section 14.

### Prompt 2 - TypeScript migration (only if I answered yes to T5)
> Execute `docs/adr/0003-typescript-migration.md` exactly, phase by phase, one branch and PR per phase. Start with
> the Phase 0 spike and tell me the result before continuing. Tests may change only on their import lines.

### Prompt 3 - Netcode hardening
> First check `docs/DESIGN.md`, then interview me (Discuss mode, only on what is still undecided) on sections N (multiplayer) and Q (quality) of `docs/DESIGN_QUESTIONS.md`. Then
> implement Phase 1 of `docs/ROADMAP.md` on its own branch: lag compensation for hit-scan (rewind by client latency,
> capped), reconnect tokens (>= 128-bit random from `crypto.randomBytes`), smooth reconciliation error correction,
> and an RTT display. Spec and failing tests first. Measure snapshot bandwidth before proposing any binary format.

### Prompt 4 - Gameplay
> First check `docs/DESIGN.md`, then interview me (Discuss mode, only on what is still undecided) on sections G, M, W, MV and P. Then, on a branch per feature (weapons, pickups, match flow,
> progression), implement them with all rules in the server and only presentation on the client. Add unit tests for
> every rule and a security test proving a client cannot claim ammo, damage or a weapon it does not own. For
> feel-based choices, give me two alternatives to compare before you commit to one.

### Prompt 5 - Rooms and lobby
> First check `docs/DESIGN.md`, then interview me (Discuss mode, only on what is still undecided) on N4-N6, SO and M5-M6. Then implement Phase 3: multiple `GameRoom` instances, a lobby with
> room listings and matchmaking. Keep `GameRoom` free of I/O. Add an integration test with two rooms at once and a
> stress test that reports tick time per room.

### Prompt 6 - Story, art, audio and content
> First check `docs/DESIGN.md`, then interview me (Discuss mode, only on what is still undecided) on S, A, AU, MP and UI. Then, on separate branches per area (they are independent), implement the
> agreed look, maps, models, sounds and HUD. Treat any loaded map or model data as untrusted: validate it and test
> malformed files. Keep the collision data the server uses in `src/shared`, identical for both sides. Ask me for
> reference images and assets you need; do not invent style decisions.

### Prompt 7 - Accounts and leaderboards
> First check `docs/DESIGN.md`, then interview me (Discuss mode, only on what is still undecided) on AC, SO and E. Propose the storage backend and wait for my choice. Base44 entities and auth
> are **not** available automatically in a Base Code project (connecting a repo adds no entities, login or SDK); using
> them would mean deliberately linking a Base44 backend project, so explain that cost. A conventional database whose
> connection string is stored as a secret is the other option. The game loop stays on this Node server either way. Then
> implement server-side sessions: >= 128-bit random ids, `HttpOnly` and `SameSite=Lax` cookies, CSRF protection on
> state-changing requests, and negative and security tests for every endpoint.

### Prompt 8 - Production
> First check `docs/DESIGN.md`, then interview me (Discuss mode, only on what is still undecided) on T3, T4, O and E. Then recommend a host that runs a persistent Node process with WebSockets,
> and add a CI deploy job that runs only on pushes to `main`, needs `checks` and `build` green, tags images with the
> commit SHA, gates on `/healthz` and rolls back on failure. Secrets go in GitHub Actions secrets and Dashboard >
> Secrets only. Pasting this prompt is my approval to edit `.github/workflows/` for the deploy job only. First pin every action to a commit SHA (see `SECURITY.md`). Show me the workflow before it can deploy anything.

### Prompt 9 - Recurring independent security review (use a different model than the builder)
> Act as an independent reviewer who has not read the tests. Read `src/` and `SECURITY.md`. List concrete
> vulnerabilities with a severity and a reproduction, and list what you checked and found clean. Write the result
> into `docs/HARDENING_REVIEW.md` as a table (id, severity, finding, status). Do not fix anything in this step.
> Afterwards, add one test per finding before fixing it, each on its own branch.
