# providers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/quiz/providers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `lp612.provider.js` | /quiz lesson provider listing Grades 6-12 plans a teacher received; makes an lp612 quiz only on tap |

## Who reads this (all, generated)
- `lp612.provider.js` ← imported by `bot/shared/services/quiz/quiz-lesson-providers.js:43:2ee07b28`
- column `quizzes.coaching_session_id` (written by `lp612.provider.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.send.js:135:9d824125` · `bot/shared/services/quiz/transcript-lesson-provider.js:184:77be8067` · `bot/shared/services/quiz/transcript-quiz-generate.service.js:2197:6bb2eefd` (+5: `python3 kg/kg.py who-reads quizzes.coaching_session_id`)
- column `quizzes.grade` (written by `lp612.provider.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/quiz/handout-class.service.js:119:c28fee2c` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+13: `python3 kg/kg.py who-reads quizzes.grade`)
- column `quizzes.language` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+13: `python3 kg/kg.py who-reads quizzes.language`)
- column `quizzes.lesson_plan_id` (written by `lp612.provider.js`) ← read by `bot/shared/services/quiz/quiz-insight.service.js:166:be1cbc63` · `bot/shared/services/quiz/web-quiz-class-twin.js:25:b28d726a`
- column `quizzes.meta` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` (+22: `python3 kg/kg.py who-reads quizzes.meta`)
- column `quizzes.quiz_source` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:301:fca7d9fc` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:70:fcf12f1a` (+26: `python3 kg/kg.py who-reads quizzes.quiz_source`)
- column `quizzes.status` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:70:fcf12f1a` (+25: `python3 kg/kg.py who-reads quizzes.status`)
- column `quizzes.subject` (written by `lp612.provider.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+13: `python3 kg/kg.py who-reads quizzes.subject`)
- column `quizzes.teacher_id` (written by `lp612.provider.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` (+20: `python3 kg/kg.py who-reads quizzes.teacher_id`)
- column `quizzes.topic` (written by `lp612.provider.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:209:d536eafa` (+22: `python3 kg/kg.py who-reads quizzes.topic`)
- table `quizzes` (written by `lp612.provider.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? · `bot/shared/routes/quiz-flow-endpoint.js:224:2c6afb51`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:273:baba8374`? (+58: `python3 kg/kg.py who-reads quizzes`)
- env `LP_612_RELIGIOUS_ENABLED` read at `bot/shared/services/quiz/providers/lp612.provider.js:75:f7a1645a`

## Tests (all, generated)
- `lp612.provider.js` ← `tests/quiz/lp612-provider.test.js`

## Related (all, generated)
- docs: `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.md`? · `bot/shared/services/quiz/providers/CLAUDE.index.md`? · `bot/shared/services/quiz/providers/CLAUDE.md`?
