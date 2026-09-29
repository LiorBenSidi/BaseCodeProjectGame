# Design decisions

The single record of **what the owner decided** about the game. The assistant fills this in during design
interviews (see `docs/DESIGN_QUESTIONS.md`); it never invents an entry. Code, specs and tests that depend on a
decision cite its ID.

## How this file works
1. A question from the bank is asked in Discuss mode. The owner answers.
2. The assistant records the answer below as a **decision** with a date, then confirms it back to the owner.
3. If the answer changes game rules, `docs/SPEC.md` is updated first, then tests, then code.
4. A decision is only changed by a new dated entry that supersedes the old one (nothing is silently edited).

## Status
| Area | Questions asked | Decided | Open |
|---|---|---|---|
| Vision and audience (V) | 0 | 0 | 12 |
| Story and setting (S) | 0 | 0 | 9 |
| Core gameplay (G) | 0 | 0 | 12 |
| Modes and rules (M) | 0 | 0 | 9 |
| Weapons and items (W) | 0 | 0 | 10 |
| Movement and feel (MV) | 0 | 0 | 6 |
| Maps (MP) | 0 | 0 | 7 |
| Art (A) | 0 | 0 | 7 |
| Audio (AU) | 0 | 0 | 5 |
| Interface (UI) | 0 | 0 | 8 |
| Controls and accessibility (C) | 0 | 0 | 4 |
| Multiplayer (N) | 0 | 0 | 10 |
| Social (SO) | 0 | 0 | 6 |
| Progression (P) | 0 | 0 | 6 |
| Economy (E) | 0 | 0 | 6 |
| Accounts and privacy (AC) | 0 | 0 | 6 |
| Platform and technology (T) | 0 | 0 | 9 |
| Quality (Q) | 0 | 0 | 7 |
| Legal (L) | 0 | 0 | 4 |
| Operations (O) | 0 | 0 | 5 |
| Roadmap (R) | 0 | 0 | 5 |

## Decision log
<!-- Newest first. Template:
### D-001 (G1) Time-to-kill
- Date: YYYY-MM-DD
- Decision: ...
- Why / options considered: ...
- Affects: docs/SPEC.md section, files, tests
- Supersedes: (none)
-->

_No decisions recorded yet._

## Open questions raised during work
_Anything the assistant discovered it needed to ask that is not in the bank yet. Add it to the bank too._
