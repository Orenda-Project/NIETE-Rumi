# classes — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/classes -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `academic-sessions.test.js` | Seeded academic_sessions spans are well formed and agree with the legacy getCurrentAcademicYear() function |
| `add-students-long-race.test.js` | ClassService.addStudents: a short second paste still lands when another writer adds a longer list; rolls stay gapless |
| `add-students-overlap.test.js` | Two overlapping bulk adds on one class both finish with distinct rolls and no un-enrolled student, one or two replicas |
| `apply-roster-edits.test.js` | ClassService.applyRosterEdits: whole edit is one rpc under the per-class lock, idempotent on run id, refuses without one |
| `class-command.test.js` | class-command matcher: /class and /classes (and whole-message plain words) open the class manager; longer words do not |
| `class-display.test.js` | class-manager-endpoint classDisplay is the single class-row label and separates morning from evening shifts |
| `class-label-parser.test.js` | bd-2720: class-label-parser turns real free-text self_reported_class values and odd digits into grade/section |
| `class-labels.test.js` | Grade and subject label maps cover the seeded reference tables exactly and fit WhatsApp field caps |
| `class-manager-endpoint.test.js` | class-manager-endpoint Flow screens against the real ClassService on an in-memory client: INIT, CLASSES, no dead ends |
| `class-service.test.js` | ClassService create class, assign teachers, and the legacy student-list mirror it keeps in step |
| `class-vocabulary-outage.test.js` | class-vocabulary lookups during a grade_levels outage with the class_vocabulary_outage_guard switch on or off |
| `class-vocabulary.test.js` | bd-2720: class-vocabulary.service resolves the four legacy grade encodings and subject aliases via seeded tables |
| `enrollment-removal-outcome.test.js` | removeStudent stamps class_enrollments.outcome 'roster_correction' rather than a departure value like 'left' |
| `import-roster.test.js` | ClassService.importRoster: a coach's scanned register creates the class and enrols children through the one writer |
| `one-edit-screen.test.js` | bd-43524: /class Flow has one edit screen (CLASSES, ROSTER, SAVED) with creation joining at ROSTER |
| `remove-class.test.js` | bd-ql2j3p: removeClassForTeacher retires a sole-owner empty class or just leaves a shared one; internal-api route |
| `roster-add-failure-named.test.js` | /class ROSTER save names how many pastes failed to land instead of saying "Nothing changed" |
| `roster-empty-class.test.js` | bd-2731: /class ROSTER renders for an empty class (no empty data-source; placeholder id cannot collide) |
| `roster-remove-every-child.test.js` | bd-a6mhn: /class ROSTER offers every child for removal in groups of 20, numbered like the roster text |
| `roster-shows-every-child.test.js` | bd-as5e4: /class ROSTER lists every child for proof-reading, no truncation marker, even for 44 children |

## Who reads this (all, generated)
- env `INTERNAL_API_KEY` read at `tests/classes/remove-class.test.js:154:180f6cef`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `docs/flows/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/classes/CLAUDE.index.md`? · `tests/classes/CLAUDE.md`?
