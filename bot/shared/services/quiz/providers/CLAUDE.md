# providers — Lesson providers for /quiz that make a quiz from a Grades 6-12 lesson plan
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/quiz/providers kg=bff5ca83818e gen=3ecb9f9b589d overflow=8 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `lp612.provider.js` — lists received 6-12 plans and creates the lp612 quiz only when tapped
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `lp612.provider.js` | /quiz lesson provider listing Grades 6-12 plans a teacher received; makes an lp612 quiz only on tap |

## Who reads this (generated)
- table `quizzes` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? (+60)
- column `quizzes.quiz_source` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:301:fca7d9fc` (+28)
- column `quizzes.status` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` (+27)
- column `quizzes.meta` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` (+24)
- column `quizzes.topic` (written by `lp612.provider.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` (+24)
- … 8 more → `CLAUDE.index.md`

## Never (human)
- Keep the provider contract {source, labelKey, list, start, get, existingQuiz} of quiz-lesson-providers.js (lp612.provider.js:7)
- quizzes.quiz_source is read by shared/routes/quiz-flow-endpoint.js:301-308, which drops only 'story' rows; keep 'lp612' as the value
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/quiz/lp612-provider.test.js` (lp612.provider.js)

## Related (generated)
- docs: `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.md`? · `bot/shared/services/quiz/providers/CLAUDE.index.md`? · `bot/shared/services/quiz/providers/CLAUDE.md`? · `tests/quiz/CLAUDE.index.md`?
