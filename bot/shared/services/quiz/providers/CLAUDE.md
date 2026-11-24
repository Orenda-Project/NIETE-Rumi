# providers — Lesson providers for /quiz that make a quiz from a Grades 6-12 lesson plan
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/quiz/providers kg=396994c27f63 gen=50fece7286b3 overflow=7 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `lp612.provider.js` — lists received 6-12 plans and creates the lp612 quiz only when tapped
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `lp612.provider.js` | /quiz lesson provider listing Grades 6-12 plans a teacher received; makes an lp612 quiz only on tap |

## Who reads this (generated)
- table `quizzes` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64`? (+68)
- column `quizzes.meta` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` (+32)
- column `quizzes.quiz_source` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` (+31)
- column `quizzes.status` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` (+30)
- column `quizzes.teacher_id` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` (+27)
- column `quizzes.topic` (written by `lp612.provider.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` (+25)
- … 7 more → `CLAUDE.index.md`

## Never (human)
- Keep the provider contract {source, labelKey, list, start, get, existingQuiz} of quiz-lesson-providers.js (lp612.provider.js:7)
- quizzes.quiz_source is read by shared/routes/quiz-flow-endpoint.js:301-308, which drops only 'story' rows; keep 'lp612' as the value
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/quiz/lp-quiz-offer-612.test.js` (lp612.provider.js)
- `tests/quiz/lp612-provider.test.js` (lp612.provider.js)

## Related (generated)
- docs: `bot/shared/services/quiz/CLAUDE.md`?
