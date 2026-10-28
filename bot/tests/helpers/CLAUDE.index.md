# helpers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/helpers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `switch-off-matrix.js` | Test helper: shared matrix of app_settings values that must read as OFF, used by the switch golden tests |
| `switch-off-matrix.test.js` | Tests the switch-off matrix helper: the frozen off values and throwOn failing only one switch's read |
| `table-double.js` | Test helper: in-memory Supabase/PostgREST table double with SQL NULL filter rules, unknown filters throw |
| `table-double.test.js` | Tests the table double: eq/neq/is-null/not semantics follow PostgREST and writes answer the rows written |

## Who reads this (all, generated)
- column `quizzes.id` (written by `table-double.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` (+58: `python3 kg/kg.py who-reads quizzes.id`)
- column `quizzes.topic` (written by `table-double.test.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:209:d536eafa` (+23: `python3 kg/kg.py who-reads quizzes.topic`)
- column `students.id` (written by `table-double.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:317:d73b0171` · `bot/shared/routes/edit-class-endpoint.js:45:dc16e319` · `bot/shared/routes/roster-flow-endpoint.js:775:3776d591` · `bot/shared/routes/student-videos-endpoint.js:267:83b95a2c` (+41: `python3 kg/kg.py who-reads students.id`)
- column `students.list_id` (written by `table-double.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:331:fb0eed0f` · `bot/shared/routes/edit-class-endpoint.js:46:fb0eed0f` · `bot/shared/services/attendance-register-delivery.service.js:121:3d987916` · `bot/shared/services/attendance-router.service.js:127:e15861a0` (+21: `python3 kg/kg.py who-reads students.list_id`)
- column `students.status` (written by `table-double.test.js`) ← read by `bot/shared/services/first-touch/go.routes.js:123:aff73d84` · `bot/shared/services/first-touch/role.service.js:128:be0e1b12` · `bot/shared/services/quiz/child-identity-reuse.js:37:0979194e` · `bot/shared/services/quiz/web-quiz-bind.service.js:93:58066c0f` (+5: `python3 kg/kg.py who-reads students.status`)
- column `students.student_name` (written by `table-double.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:317:d73b0171` · `bot/shared/routes/edit-class-endpoint.js:45:dc16e319` · `bot/shared/routes/roster-flow-endpoint.js:775:3776d591` · `bot/shared/routes/student-videos-endpoint.js:266:d71c8cd6` (+28: `python3 kg/kg.py who-reads students.student_name`)
- table `students` whole row (`*`) (written by `table-double.test.js`) ← read by `bot/shared/services/student-list.service.js:362:d2b02c3e`?
- table `quizzes` (written by `table-double.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? · `bot/shared/routes/quiz-flow-endpoint.js:224:2c6afb51`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:273:baba8374`? (+59: `python3 kg/kg.py who-reads quizzes`)
- table `students` (written by `table-double.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? · `bot/shared/routes/roster-flow-endpoint.js:775:3776d591`? · `bot/shared/routes/student-videos-endpoint.js:266:d71c8cd6`? (+42: `python3 kg/kg.py who-reads students`)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/helpers/CLAUDE.index.md`? · `bot/tests/helpers/CLAUDE.md`?
