# classes — The /class manager: ClassService, roster Flow screens, labels and vocabulary
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/classes kg=08fb378a2536 gen=14699939e414 overflow=3 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `class-service.test.js` — create class, assign teachers, legacy student-list mirror
- `class-manager-endpoint.test.js` — Flow screens against the real ClassService
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/classes --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `class*` | 8 files; most used `class-manager-endpoint.test.js`: class-manager-endpoint Flow screens against the real ClassService on an in-memory client: INIT, CLASSES, no dead ends |
| `roster*` | 4 files; most used `roster-add-failure-named.test.js`: /class ROSTER save names how many pastes failed to land instead of saying "Nothing changed" |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `one-edit-screen.test.js` | bd-43524: /class Flow has one edit screen (CLASSES, ROSTER, SAVED) with creation joining at ROSTER |
| `academic-sessions.test.js` | Seeded academic_sessions spans are well formed and agree with the legacy getCurrentAcademicYear() function |
| `add-students-long-race.test.js` | ClassService.addStudents: a short second paste still lands when another writer adds a longer list; rolls stay gapless |
| `add-students-overlap.test.js` | Two overlapping bulk adds on one class both finish with distinct rolls and no un-enrolled student, one or two replicas |
| `remove-class.test.js` | bd-ql2j3p: removeClassForTeacher retires a sole-owner empty class or just leaves a shared one; internal-api route |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY`

## Never (human)
- Roster writes go through ClassService under one per-class lock (tests/classes/apply-roster-edits.test.js:4)
- A failed paste is never reported as "Nothing changed" (tests/classes/roster-add-failure-named.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `docs/flows/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? (+3)
