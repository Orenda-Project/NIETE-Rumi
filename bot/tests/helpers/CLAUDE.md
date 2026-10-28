# helpers — Shared test doubles: Supabase table double and switch-off matrix
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/helpers kg=346c391de8ae gen=333ade05f0a2 overflow=5 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `table-double.js` — PostgREST-faithful in-memory tables; unknown filters throw
- `switch-off-matrix.js` — app_settings values that must all read as OFF
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `switch-off-matrix.js` | Test helper: shared matrix of app_settings values that must read as OFF, used by the switch golden tests |
| `table-double.js` | Test helper: in-memory Supabase/PostgREST table double with SQL NULL filter rules, unknown filters throw |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `switch-off-matrix.test.js` | Tests the switch-off matrix helper: the frozen off values and throwOn failing only one switch's read |
| `table-double.test.js` | Tests the table double: eq/neq/is-null/not semantics follow PostgREST and writes answer the rows written |

## Who reads this (generated)
- table `quizzes` (written by `table-double.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? (+61)
- column `quizzes.id` (written by `table-double.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` (+60)
- table `students` (written by `table-double.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? (+44)
- column `students.id` (written by `table-double.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:317:d73b0171` · `bot/shared/routes/edit-class-endpoint.js:45:dc16e319` (+43)
- … 5 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/helpers/CLAUDE.index.md`? · `bot/tests/helpers/CLAUDE.md`?
