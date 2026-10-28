# teacher-quiz-menu — Tests for the teacher /quiz home, report list and button routing

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz/teacher-quiz-menu kg=25ba975cfce2 gen=79100a681611 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `teacher-quiz-routing.test.js` — tqh_/tqr_ button ids through the real POST /webhook
- `fake-db.js` — table double that records reads so tests can count round-trips
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fake-db.js` | Table-driven supabase double for the teacher /quiz menu tests; records each read so round-trips can be counted |
| `teacher-quiz-home.test.js` | W37 M3a: teacher /quiz home with three buttons gated by teacher_report_teachers; absent setting is today's /quiz |
| `teacher-report-list.test.js` | W37 M3a: "My quiz reports" row text, class-size counts and the report link built by the real list and data-core |
| `teacher-quiz-home-named.test.js` | Pins that a coach named by id in teacher_report_teachers gets the teacher /quiz home; "all" never lifts role gate |
| `CLAUDE.md` | (unmapped) |
| `teacher-quiz-routing.test.js` | Pre-merge class A: tqh_make/tqh_reports/tqh_class and tqr_ ids reach handlers through the real POST /webhook |

## Who reads this (generated)
- env read here: `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
- Keep fake-db on the shared tableDouble so an unknown filter throws (fake-db.js:6-8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.md`? · `bot/tests/quiz/teacher-quiz-menu/CLAUDE.md`?
