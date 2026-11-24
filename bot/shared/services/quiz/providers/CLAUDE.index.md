# providers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/quiz/providers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `lp612.provider.js` | /quiz lesson provider listing Grades 6-12 plans a teacher received; makes an lp612 quiz only on tap |

## Who reads this (all, generated)
- `lp612.provider.js` ← imported by `bot/shared/services/nudges/lp-quiz-offer-612.js:46:ecc2ee0f` · `bot/shared/services/quiz/quiz-lesson-providers.js:43:2ee07b28`
- column `quizzes.coaching_session_id` (written by `lp612.provider.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.send.js:141:9d824125` · `bot/shared/services/quiz/closed-window-offer.js:120:ad221912` · `bot/shared/services/quiz/transcript-lesson-provider.js:186:77be8067` (+6: `python3 kg/kg.py who-reads quizzes.coaching_session_id`)
- column `quizzes.grade` (written by `lp612.provider.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:107:94d3eeca` · `bot/shared/services/quiz/handout-class.service.js:119:c28fee2c` · `bot/shared/services/quiz/lp-quiz-cache.js:144:36826a1f` (+15: `python3 kg/kg.py who-reads quizzes.grade`)
- column `quizzes.language` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:225:f35ba6d0` (+18: `python3 kg/kg.py who-reads quizzes.language`)
- column `quizzes.lesson_plan_id` (written by `lp612.provider.js`) ← read by `bot/shared/services/quiz/quiz-insight.service.js:166:be1cbc63` · `bot/shared/services/quiz/web-quiz-class-twin.js:25:b28d726a`
- column `quizzes.meta` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` (+30: `python3 kg/kg.py who-reads quizzes.meta`)
- column `quizzes.quiz_source` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:306:fca7d9fc` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` (+29: `python3 kg/kg.py who-reads quizzes.quiz_source`)
- column `quizzes.status` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` (+28: `python3 kg/kg.py who-reads quizzes.status`)
- column `quizzes.subject` (written by `lp612.provider.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:107:94d3eeca` · `bot/shared/services/quiz/lp-quiz-cache.js:144:36826a1f` (+15: `python3 kg/kg.py who-reads quizzes.subject`)
- column `quizzes.teacher_id` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` (+25: `python3 kg/kg.py who-reads quizzes.teacher_id`)
- column `quizzes.topic` (written by `lp612.provider.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:225:f35ba6d0` (+23: `python3 kg/kg.py who-reads quizzes.topic`)
- table `quizzes` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? · `bot/shared/routes/quiz-flow-endpoint.js:229:2c6afb51`? (+66: `python3 kg/kg.py who-reads quizzes`)
- env `LP_612_RELIGIOUS_ENABLED` read at `bot/shared/services/quiz/providers/lp612.provider.js:80:f7a1645a`

## Tests (all, generated)
- `lp612.provider.js` ← `tests/quiz/lp-quiz-offer-612.test.js` · `tests/quiz/lp612-provider.test.js`

## Related (all, generated)
- docs: `bot/shared/services/quiz/CLAUDE.md`?
