# classes — Classes model: write surface, label parsing, vocabulary and class manager door
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/classes kg=0840eac5136c gen=1c85da19d540 overflow=59 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `class.service.js` — classes, teachers, subjects, enrolment writes
- `class-entry.service.js` — door guarding teachers with no school
- `roster-label.js` — the one roster row label
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `class*` | 5 files; most used `class.service.js`: ClassService: write surface for classes, teachers, subjects and student enrolment (largest classes module) |
| `roster-label.js` | Single formatter for a roster row label and WhatsApp row title with the 24-char cap |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- table `students` (written by `class.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? (+43)
- column `students.student_name` (written by `class.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:317:d73b0171` · `bot/shared/routes/edit-class-endpoint.js:45:dc16e319` (+29)
- column `students.is_active` (written by `class.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:332:f8c426e2` · `bot/shared/routes/edit-class-endpoint.js:47:f8c426e2` (+25)
- table `student_lists` (written by `class.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:298:8479d615`? · `bot/shared/routes/attendance-setup-endpoint.js:174:8479d615`? (+25)
- … 39 more → `CLAUDE.index.md`

## Never (human)
- Name rosters only via `roster-label.js` (duplication shipped bad labels, `roster-label.js:3-6`)
- A class needs a school: `classes.school_id` is NOT NULL (`class-entry.service.js:6`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/web-quiz/web-quiz-fix-who-roll.test.js` (class.service.js)
- `tests/attendance/completion-classified-from-token.test.js` (class-entry.service.js)
- … 20 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`?
