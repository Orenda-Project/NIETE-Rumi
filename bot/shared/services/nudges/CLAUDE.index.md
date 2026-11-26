# nudges — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/nudges -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `weak-skill-jugnu/` | (no description yet) → `weak-skill-jugnu/CLAUDE.md` |
| `caps.js` | Pure weekly caps deciding whether a nudge may be sent to a teacher, from teacher_nudges rows and the PKT date |
| `flags.js` | Shared flag reading for R8 nudge switches (flagOn, onUnlessOff) so sweeper, ask and offer agree (bd-mg9c7.159.10) |
| `lp-coaching-ask.service.js` | The coaching ask: one nudge on the first lesson plan a teacher takes in a day, offering recording and coaching |
| `lp-quiz-offer-612.js` | (unmapped) |
| `lp-quiz-offer-rules.js` | (unmapped) |
| `lp-quiz-offer.service.js` | The 15:00 PKT afternoon quiz offer built from lessons a teacher planned that day, one teacher_nudges row each |
| `open-question.js` | Tracks the 10-minute open-question window after a thumbs-down so the next plain text is the survey answer |
| `pkt-time.js` | PKT calendar arithmetic (UTC+5, no DST) for scheduling teacher nudges by school day |
| `reminder-stop.js` | Handles STOP/«روکیں» to the window-closed reminder template and records opt-outs in teacher_reminder_optouts |
| `send-retry.js` | (unmapped) |
| `teacher-nudges.store.js` | Main teacher_nudges store holding the scheduling guards; lp-coaching-ask.service.js:558 also updates rows directly |
| `teacher-nudges.sweeper.js` | Periodic sweeper for scheduled teacher nudges: expire stuck rows, prepare cohorts, claim due rows, dispatch handlers |
| `topic-end-arm.js` | (unmapped) |
| `topic-end-nudge.service.js` | (unmapped) |
| `topic-end-recording.js` | (unmapped) |
| `topic-end.js` | (unmapped) |
| `window-closed-template.js` | UTILITY template (teacher_quiz_reminder_v1) path for the afternoon quiz offer when the 24h window has closed |

## Who reads this (all, generated)
- `caps.js` ← imported by `bot/shared/services/nudges/lp-coaching-ask.service.js:56:ebedc4df`
- `flags.js` ← imported by `bot/shared/services/coaching/coaching-session.service.js:107:718b0d1b` · `bot/shared/services/coaching/portal-class-check.js:82:718b0d1b` · `bot/shared/services/quiz/video-quiz-report.service.js:48:718b0d1b` · `bot/workers/push-ticks.js:11:b307ceb4` (+5: `python3 kg/kg.py who-reads flags.js`)
- `lp-coaching-ask.service.js` ← imported by `bot/shared/handlers/voice-message.handler.js:982:87b3543a` · `bot/shared/routes/internal-api.routes.js:1528:87b3543a` · `bot/shared/services/lp-v8-delivery.service.js:467:04f672bc` · `bot/whatsapp-bot.js:1502:d519231a` (+1: `python3 kg/kg.py who-reads lp-coaching-ask.service.js`)
- `lp-quiz-offer-612.js` ← imported by `bot/shared/services/nudges/lp-quiz-offer.service.js:462:66437966`
- `lp-quiz-offer-rules.js` ← imported by `bot/shared/services/quiz/providers/lp612.provider.js:90:2b501c53` · `bot/shared/services/nudges/lp-quiz-offer-612.js:31:204bf21b` · `bot/shared/services/nudges/lp-quiz-offer.service.js:124:f49a89f1`
- `lp-quiz-offer.service.js` ← imported by `bot/shared/services/quiz/lp-v8-lesson-provider.js:61:912fd9aa` · `bot/shared/services/quiz/web-quiz-evening-round.js:145:275518e4` · `bot/whatsapp-bot.js:1473:e78268a3` · `bot/workers/sqs-worker.js:2185:f2f95660`
- `open-question.js` ← imported by `bot/shared/services/nudges/teacher-nudges.sweeper.js:119:8617c21e`
- `pkt-time.js` ← imported by `bot/shared/services/ab-tracker/ab-tracker-cadence.js:12:7ad5bda7` · `bot/shared/services/ab-tracker/ab-tracker-rollup.service.js:26:c3b04493` · `bot/shared/services/coaching/weekly-report/week.js:13:a83d1da7` · `bot/shared/services/conversation-resume.service.js:36:0b33b996` (+16: `python3 kg/kg.py who-reads pkt-time.js`)
- `reminder-stop.js` ← imported by `bot/shared/handlers/text-message.handler.js:578:7345f2fc`
- `send-retry.js` ← imported by `bot/shared/services/nudges/lp-quiz-offer.service.js:64:3fc760ed`
- `teacher-nudges.store.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:15:cd646e88` · `bot/shared/services/nudges/lp-coaching-ask.service.js:186:a96e1f66` · `bot/shared/services/nudges/lp-quiz-offer-612.js:22:4c8b8a4a` · `bot/shared/services/nudges/lp-quiz-offer.service.js:47:4c8b8a4a` (+3: `python3 kg/kg.py who-reads teacher-nudges.store.js`)
- `teacher-nudges.sweeper.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:131:a772dfc6` · `bot/workers/sqs-worker.js:2179:17fcff80` · `bot/shared/services/nudges/lp-coaching-ask.service.js:696:029cdc9d` · `bot/shared/services/nudges/lp-quiz-offer.service.js:1264:27d92175` (+2: `python3 kg/kg.py who-reads teacher-nudges.sweeper.js`)
- `topic-end-arm.js` ← imported by `bot/shared/services/nudges/topic-end-nudge.service.js:33:dc8b1afa` · `bot/shared/services/nudges/topic-end-recording.js:25:dc8b1afa`
- `topic-end-nudge.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1533:c1e58076` · `bot/shared/services/lp-v8-delivery.service.js:483:2aa4f6b5` · `bot/workers/sqs-worker.js:2191:04310a00` · `bot/shared/services/nudges/topic-end-recording.js:72:1efd4e97`
- `topic-end-recording.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:712:3722a4d2`
- `topic-end.js` ← imported by `bot/shared/services/nudges/topic-end-nudge.service.js:36:a8a24fed`
- `window-closed-template.js` ← imported by `bot/shared/services/nudges/lp-quiz-offer.service.js:63:e226ae2c` · `bot/shared/services/nudges/reminder-stop.js:23:2a3feced`
- column `quizzes.coaching_session_id` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.send.js:142:9d824125` · `bot/shared/services/quiz/closed-window-offer.js:123:ad221912` · `bot/shared/services/quiz/transcript-lesson-provider.js:188:77be8067` (+7: `python3 kg/kg.py who-reads quizzes.coaching_session_id`)
- column `quizzes.grade` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:107:94d3eeca` · `bot/shared/services/quiz/handout-class.service.js:119:c28fee2c` · `bot/shared/services/quiz/lp-quiz-cache.js:144:36826a1f` (+16: `python3 kg/kg.py who-reads quizzes.grade`)
- column `quizzes.lesson_plan_id` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/services/quiz/quiz-insight.service.js:166:be1cbc63` · `bot/shared/services/quiz/web-quiz-class-twin.js:25:b28d726a`
- column `quizzes.meta` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` (+31: `python3 kg/kg.py who-reads quizzes.meta`)
- column `quizzes.quiz_source` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:306:fca7d9fc` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` (+31: `python3 kg/kg.py who-reads quizzes.quiz_source`)
- column `quizzes.status` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` (+29: `python3 kg/kg.py who-reads quizzes.status`)
- column `quizzes.subject` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:107:94d3eeca` · `bot/shared/services/quiz/lp-quiz-cache.js:144:36826a1f` (+17: `python3 kg/kg.py who-reads quizzes.subject`)
- column `quizzes.teacher_id` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64` · `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` (+26: `python3 kg/kg.py who-reads quizzes.teacher_id`)
- column `quizzes.topic` (written by `lp-quiz-offer.service.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:230:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:275:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:225:f35ba6d0` (+24: `python3 kg/kg.py who-reads quizzes.topic`)
- column `teacher_nudges.choice` (written by `lp-coaching-ask.service.js`) ← read by `bot/shared/services/nudges/lp-quiz-offer.service.js:419:fc9cc59e`
- column `teacher_nudges.updated_at` (written by `lp-coaching-ask.service.js`) ← read by `bot/shared/services/nudges/reminder-stop.js:44:84df21d8`
- table `quizzes` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/gb-quiz-readiness.js:44:fa852d64`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? · `bot/shared/routes/quiz-flow-endpoint.js:229:2c6afb51`? (+68: `python3 kg/kg.py who-reads quizzes`)
- table `teacher_nudges` (written by `lp-coaching-ask.service.js`) ← read by `bot/shared/services/observe/coach-report-whatsapp.service.js:377:b4dc82ab`? · `bot/shared/services/nudges/lp-quiz-offer.service.js:249:536318ed`? · `bot/shared/services/nudges/reminder-stop.js:44:84df21d8`?
- env `LP_COACHING_ASK_DELAY_MINUTES` read at `bot/shared/services/nudges/lp-coaching-ask.service.js:84:884236f2`
- env `LP_COACHING_ASK_WEEKLY_CAP` read at `bot/shared/services/nudges/lp-coaching-ask.service.js:347:add8c736`
- env `LP_QUIZ_OFFER_INTRO_VIDEO` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:698:8a30ba8a`
- env `LP_QUIZ_OFFER_INTRO_VIDEO_EN` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:693:b84a6375`
- env `LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:706:3cbe6ca4`
- env `LP_QUIZ_OFFER_INTRO_VIDEO_UR` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:692:42cc6996`
- env `LP_QUIZ_OFFER_NATIVE_DIGITS` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:675:509cd61a`
- env `LP_QUIZ_OFFER_SECTORS` read at `bot/shared/services/nudges/lp-quiz-offer.service.js:131:46b323fb`

## Tests (all, generated)
- `caps.js` ← `tests/lp-v8/lp-coaching-ask-caps.test.js`
- `flags.js` ← `tests/coaching/video-reco/flags.test.js`? · `tests/lp612/flags.test.js`?
- `lp-coaching-ask.service.js` ← `bot/tests/lp-v8/lp-coaching-ask-worker-wiring.test.js` · `bot/tests/nudges/nudge-flags.test.js` · `tests/lp-v8/bd-v0toag.46-record-line.test.js` · `tests/lp-v8/lp-coaching-ask-answer.test.js` · `tests/lp-v8/lp-coaching-ask-app-open.test.js` · `tests/lp-v8/lp-coaching-ask-next-day.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/nudges/lp-coaching-ask.service.js`)
- `lp-quiz-offer-612.js` ← `tests/quiz/lp-quiz-offer-612.test.js`?
- `lp-quiz-offer-rules.js` ← `tests/quiz/lp-quiz-offer-rules.test.js`
- `lp-quiz-offer.service.js` ← `bot/tests/nudges/nudge-flags.test.js` · `tests/qfix-offers/held-path.test.js` · `tests/qfix-offers/lp-taken-today.test.js` · `tests/qfix-offers/offer-net-retry.test.js` · `tests/quiz/lp-app-opens-served-and-listed.test.js` · `tests/quiz/lp-quiz-app-open-counts.test.js` (+16: `python3 kg/kg.py who-reads bot/shared/services/nudges/lp-quiz-offer.service.js`)
- `open-question.js` ← `tests/lp-v8/lp-coaching-ask-survey-window.test.js`
- `pkt-time.js` ← `bot/tests/nudges/pkt-time.test.js` · `bot/tests/qfix-class-link/next-offer-round.test.js` · `bot/tests/qfix-class-link/remind-mount.test.js` · `bot/tests/qfix-class-link/round-never-rewrites.test.js` · `bot/tests/qfix-class-link/round-sitting.test.js` · `bot/tests/qfix-class-link/who-quiz-ready.test.js` (+21: `python3 kg/kg.py who-reads bot/shared/services/nudges/pkt-time.js`)
- `reminder-stop.js` ← `tests/quiz/reminder-stop.test.js`
- `send-retry.js` ← `tests/qfix-offers/offer-net-retry.test.js`
- `teacher-nudges.store.js` ← `bot/tests/coaching/weekly-report/migration.test.js` · `bot/tests/nudges/teacher-nudges.store.test.js` · `bot/tests/nudges/topic-end-nudge-migration.test.js` · `bot/tests/nudges/weak-skill-jugnu/migration.test.js` · `tests/lp-v8/lp-coaching-ask-answer.test.js` · `tests/lp-v8/lp-coaching-ask-next-day.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/nudges/teacher-nudges.store.js`)
- `teacher-nudges.sweeper.js` ← `bot/tests/nudges/nudge-flags.test.js` · `bot/tests/nudges/teacher-nudges.sweeper.test.js` · `tests/lp-v8/lp-coaching-ask-send.test.js` · `tests/lp-v8/lp-coaching-ask-survey-window.test.js` · `tests/qfix-offers/held-path.test.js` · `tests/qfix-offers/offer-net-retry.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/nudges/teacher-nudges.sweeper.js`)
- `topic-end-arm.js` ← `bot/tests/nudges/topic-end-nudge-migration.test.js` · `bot/tests/nudges/topic-end-nudge-rls-migration.test.js` · `tests/lp-v8/topic-end-nudge-held.test.js` · `tests/lp-v8/topic-end-nudge-recording.test.js` · `tests/lp-v8/topic-end-nudge.test.js`
- `topic-end-nudge.service.js` ← `tests/lp-v8/topic-end-nudge-held.test.js` · `tests/lp-v8/topic-end-nudge-recording.test.js` · `tests/lp-v8/topic-end-nudge-wiring.test.js` · `tests/lp-v8/topic-end-nudge.test.js`
- `topic-end-recording.js` ← `tests/coaching/bd-pw1ccr.11-recording-books-topic-nudge.test.js` · `tests/lp-v8/topic-end-nudge-recording.test.js`
- `topic-end.js` ← `tests/lp-v8/topic-end.test.js`
- `window-closed-template.js` ← `tests/qfix-offers/held-path.test.js` · `tests/quiz/lp-quiz-offer-window-template.test.js` · `tests/quiz/reminder-stop.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/quiz-telemetry.md`? · `infrastructure/templates/drafts/README.md`?
