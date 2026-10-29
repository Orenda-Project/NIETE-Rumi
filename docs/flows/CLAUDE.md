# flows — Checked-in WhatsApp Flow JSON for every Flow the bot publishes, plus rollbacks
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=docs/flows kg=89183c47c801 gen=e275632c2217 overflow=43 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `registration-flow-v5.1.json` — current registration Flow
- `assessment-gen-flow.README.md` — endpoint Flow screen order and how review screens are reached
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `remark-mockups/` | → (no door; 3 files) |
| `rollback/` | Frozen snapshots of live Flows taken before a cutover, for rollback → `rollback/CLAUDE.md` |
| `observe-visit-v2.json` | Flow JSON v7.0, 32 screens: coach /observe visit (menu, debriefs, work form, schedule, school and teacher pick) |
| `attendance-marking-flow.json` | Flow JSON v6.3: mark attendance by exception for teachers (students) and principals (staff); date, mark, leave, confirm |
| `class-manager-flow.json` | Flow JSON v6.3: manage classes (list, add, subjects, roster, saved) |
| `assessment*` | 3 files; most used `assessment-gen-flow.json`: Flow JSON v7.3: assessment generator form (class, coverage, pages, question types, counts, confirm), endpoint-driven |
| `attendance-setup-flow.json` | Flow JSON v6.3: set up a class for attendance (class, roster, review, success) |
| `child-test-review.json` | Flow JSON v7.3: single REVIEW screen for the coach to check a child's test result |
| `quiz-multi-select-flow.json` | Static Flow JSON v6.3: select-all-that-apply answer screen for transcript-quiz questions |
| `pakistan-lp-flow.v*.json` | 3 versions — v3 imported; v3: Flow JSON v7.0: Pakistan lesson-plan picker with chapter and lesson paging and language choice |
| … | 26 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- A Flow file here is not proof it is published; verify the live Flow before claiming it (root rule: defined is not published)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/flow-response-telemetry.test.js` (pakistan-lp-flow-v3.json)
- `bot/tests/observe/bd-88krt-school-admin.test.js` (observe-visit-v2.json)
- … 25 more → `CLAUDE.index.md`

## Related (generated)
- skills: `registration`?
- docs: `docs/CLAUDE.md`? · `docs/features/attendance.md`? · `docs/features/registration.md`? · `infrastructure/flows/README.md`?
