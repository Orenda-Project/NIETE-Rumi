# nudges — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/nudges -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `caps.js` | Pure weekly caps deciding whether a nudge may be sent to a teacher, from teacher_nudges rows and the PKT date |
| `flags.js` | Shared flag reading for R8 nudge switches (flagOn, onUnlessOff) so sweeper, ask and offer agree (bd-mg9c7.159.10) |
| `lp-coaching-ask.service.js` | The coaching ask: one nudge on the first lesson plan a teacher takes in a day, offering recording and coaching |
| `lp-quiz-offer.service.js` | The 15:00 PKT afternoon quiz offer built from lessons a teacher planned that day, one teacher_nudges row each |
| `open-question.js` | Tracks the 10-minute open-question window after a thumbs-down so the next plain text is the survey answer |
| `pkt-time.js` | PKT calendar arithmetic (UTC+5, no DST) for scheduling teacher nudges by school day |
| `reminder-stop.js` | Handles STOP/«روکیں» to the window-closed reminder template and records opt-outs in teacher_reminder_optouts |
| `teacher-nudges.store.js` | Main teacher_nudges store holding the scheduling guards; lp-coaching-ask.service.js:558 also updates rows directly |
| `teacher-nudges.sweeper.js` | Periodic sweeper for scheduled teacher nudges: expire stuck rows, prepare cohorts, claim due rows, dispatch handlers |
| `topic-end-arm.js` | (unmapped) |
| `topic-end-nudge.service.js` | (unmapped) |
| `topic-end.js` | (unmapped) |
| `window-closed-template.js` | UTILITY template (teacher_quiz_reminder_v1) path for the afternoon quiz offer when the 24h window has closed |

## Who reads this (all, generated)
- `caps.js` ← imported by `bot/shared/services/nudges/lp-coaching-ask.service.js:51:ebedc4df`
- `flags.js` ← imported by `bot/shared/services/coaching/coaching-session.service.js:107:718b0d1b` · `bot/shared/services/coaching/portal-class-check.js:82:718b0d1b` · `bot/shared/services/quiz/video-quiz-report.service.js:47:718b0d1b` · `bot/workers/push-ticks.js:10:b307ceb4` (+4: `python3 kg/kg.py who-reads flags.js`)
- `lp-coaching-ask.service.js` ← imported by `bot/shared/handlers/voice-message.handler.js:961:87b3543a` · `bot/shared/routes/internal-api.routes.js:1426:87b3543a` · `bot/shared/services/lp-v8-delivery.service.js:454:04f672bc` · `bot/whatsapp-bot.js:1435:d519231a` (+1: `python3 kg/kg.py who-reads lp-coaching-ask.service.js`)
- `lp-quiz-offer.service.js` ← imported by `bot/shared/services/quiz/lp-v8-lesson-provider.js:55:912fd9aa` · `bot/shared/services/quiz/providers/lp612.provider.js:85:95424988` · `bot/whatsapp-bot.js:1406:e78268a3` · `bot/workers/sqs-worker.js:2030:f2f95660`
- `open-question.js` ← imported by `bot/shared/services/nudges/teacher-nudges.sweeper.js:119:8617c21e`
- `pkt-time.js` ← imported by `bot/shared/services/coaching/weekly-report/week.js:13:a83d1da7` · `bot/shared/services/conversation-resume.service.js:36:0b33b996` · `bot/shared/services/nudges/lp-coaching-ask.service.js:46:972b4209` · `bot/shared/services/nudges/lp-quiz-offer.service.js:40:2fb5d488` (+2: `python3 kg/kg.py who-reads pkt-time.js`)
- `reminder-stop.js` ← imported by `bot/shared/handlers/text-message.handler.js:559:7345f2fc`
- `teacher-nudges.store.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:15:cd646e88` · `bot/shared/services/nudges/lp-coaching-ask.service.js:181:a96e1f66` · `bot/shared/services/nudges/lp-quiz-offer.service.js:42:4c8b8a4a` · `bot/shared/services/nudges/teacher-nudges.sweeper.js:42:a96e1f66` (+1: `python3 kg/kg.py who-reads teacher-nudges.store.js`)
- `teacher-nudges.sweeper.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:131:a772dfc6` · `bot/workers/sqs-worker.js:2024:17fcff80` · `bot/shared/services/nudges/lp-coaching-ask.service.js:687:029cdc9d` · `bot/shared/services/nudges/lp-quiz-offer.service.js:1181:27d92175` (+1: `python3 kg/kg.py who-reads teacher-nudges.sweeper.js`)
- `topic-end-arm.js` ← imported by `bot/shared/services/nudges/topic-end-nudge.service.js:27:dc8b1afa`
- `topic-end-nudge.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1431:c1e58076` · `bot/shared/services/lp-v8-delivery.service.js:470:2aa4f6b5` · `bot/workers/sqs-worker.js:2036:04310a00`
- `topic-end.js` ← imported by `bot/shared/services/nudges/topic-end-nudge.service.js:30:a8a24fed`
- `window-closed-template.js` ← imported by `bot/shared/services/nudges/lp-quiz-offer.service.js:57:e226ae2c` · `bot/shared/services/nudges/reminder-stop.js:23:2a3feced`
- column `quizzes.coaching_session_id` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.send.js:135:9d824125` · `bot/shared/services/quiz/transcript-lesson-provider.js:184:77be8067` · `bot/shared/services/quiz/transcript-quiz-generate.service.js:2197:6bb2eefd` (+5: `python3 kg/kg.py who-reads quizzes.coaching_session_id`)
- column `quizzes.grade` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/quiz/handout-class.service.js:119:c28fee2c` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+13: `python3 kg/kg.py who-reads quizzes.grade`)
- column `quizzes.lesson_plan_id` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/services/quiz/quiz-insight.service.js:166:be1cbc63` · `bot/shared/services/quiz/web-quiz-class-twin.js:25:b28d726a`
- column `quizzes.meta` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` (+22: `python3 kg/kg.py who-reads quizzes.meta`)
- column `quizzes.quiz_source` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:301:fca7d9fc` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:70:fcf12f1a` (+26: `python3 kg/kg.py who-reads quizzes.quiz_source`)
- column `quizzes.status` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:70:fcf12f1a` (+26: `python3 kg/kg.py who-reads quizzes.status`)
- column `quizzes.subject` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+14: `python3 kg/kg.py who-reads quizzes.subject`)
- column `quizzes.teacher_id` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` (+20: `python3 kg/kg.py who-reads quizzes.teacher_id`)
- column `quizzes.topic` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:209:d536eafa` (+23: `python3 kg/kg.py who-reads quizzes.topic`)
- column `teacher_nudges.choice` (written by `lp-coaching-ask.service.js`) ← read by `bot/shared/services/nudges/lp-quiz-offer.service.js:445:fc9cc59e`
- column `teacher_nudges.updated_at` (written by `lp-coaching-ask.service.js`) ← read by `bot/shared/services/nudges/reminder-stop.js:44:84df21d8`
- table `quizzes` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? · `bot/shared/routes/quiz-flow-endpoint.js:224:2c6afb51`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:273:baba8374`? (+58: `python3 kg/kg.py who-reads quizzes`)
- table `teacher_nudges` (written by `lp-coaching-ask.service.js`) ← read by `bot/shared/services/nudges/lp-quiz-offer.service.js:275:536318ed`? · `bot/shared/services/nudges/reminder-stop.js:44:84df21d8`?
- env `LP_COACHING_ASK_DELAY_MINUTES` read at `bot/shared/services/nudges/lp-coaching-ask.service.js:79:884236f2`
- env `LP_COACHING_ASK_WEEKLY_CAP` read at `bot/shared/services/nudges/lp-coaching-ask.service.js:342:add8c736`
- env `LP_QUIZ_OFFER_INTRO_VIDEO` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:638:8a30ba8a`
- env `LP_QUIZ_OFFER_INTRO_VIDEO_EN` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:633:b84a6375`
- env `LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:646:3cbe6ca4`
- env `LP_QUIZ_OFFER_INTRO_VIDEO_UR` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:632:42cc6996`
- env `LP_QUIZ_OFFER_NATIVE_DIGITS` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:615:509cd61a`
- env `LP_QUIZ_OFFER_SECTORS` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:129:46b323fb`

## Tests (all, generated)
- `caps.js` ← `tests/lp-v8/lp-coaching-ask-caps.test.js`
- `flags.js` ← `tests/coaching/video-reco/flags.test.js`? · `tests/lp612/flags.test.js`?
- `lp-coaching-ask.service.js` ← `bot/tests/lp-v8/lp-coaching-ask-worker-wiring.test.js` · `bot/tests/nudges/nudge-flags.test.js` · `tests/lp-v8/bd-v0toag.46-record-line.test.js` · `tests/lp-v8/lp-coaching-ask-answer.test.js` · `tests/lp-v8/lp-coaching-ask-app-open.test.js` · `tests/lp-v8/lp-coaching-ask-next-day.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/nudges/lp-coaching-ask.service.js`)
- `lp-quiz-offer.service.js` ← `bot/tests/nudges/nudge-flags.test.js` · `tests/quiz/lp-app-opens-served-and-listed.test.js` · `tests/quiz/lp-quiz-app-open-counts.test.js` · `tests/quiz/lp-quiz-cohort-source-gate.test.js` · `tests/quiz/lp-quiz-cohort.test.js` · `tests/quiz/lp-quiz-language-ask.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/services/nudges/lp-quiz-offer.service.js`)
- `open-question.js` ← `tests/lp-v8/lp-coaching-ask-survey-window.test.js`
- `pkt-time.js` ← `bot/tests/nudges/pkt-time.test.js` · `tests/conversation-state/resume-quiet-hours.test.js` · `tests/lp-v8/lp-coaching-ask-next-day.test.js` · `tests/quiz/helpers/lp-offer-scenarios.js` · `tests/quiz/lp-app-opens-served-and-listed.test.js` · `tests/quiz/lp-quiz-app-open-counts.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/services/nudges/pkt-time.js`)
- `reminder-stop.js` ← `tests/quiz/reminder-stop.test.js`
- `teacher-nudges.store.js` ← `bot/tests/coaching/weekly-report/migration.test.js` · `bot/tests/nudges/teacher-nudges.store.test.js` · `bot/tests/nudges/topic-end-nudge-migration.test.js` · `tests/lp-v8/lp-coaching-ask-answer.test.js` · `tests/lp-v8/lp-coaching-ask-next-day.test.js` · `tests/lp-v8/lp-coaching-ask-schedule.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/nudges/teacher-nudges.store.js`)
- `teacher-nudges.sweeper.js` ← `bot/tests/nudges/nudge-flags.test.js` · `bot/tests/nudges/teacher-nudges.sweeper.test.js` · `tests/lp-v8/lp-coaching-ask-send.test.js` · `tests/lp-v8/lp-coaching-ask-survey-window.test.js` · `tests/quiz/lp-quiz-offer-send.test.js` · `tests/quiz/lp-quiz-offer-window-template.test.js`
- `topic-end-arm.js` ← `bot/tests/nudges/topic-end-nudge-migration.test.js` · `tests/lp-v8/topic-end-nudge.test.js`
- `topic-end-nudge.service.js` ← `tests/lp-v8/topic-end-nudge-wiring.test.js` · `tests/lp-v8/topic-end-nudge.test.js`
- `topic-end.js` ← `tests/lp-v8/topic-end.test.js`
- `window-closed-template.js` ← `tests/quiz/lp-quiz-offer-window-template.test.js` · `tests/quiz/reminder-stop.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/quiz-telemetry.md`? · `infrastructure/templates/drafts/README.md`?
