# handlers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/handlers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 1 files: 0 test + 1 support) |
| `account-state-reply.js` | Separates "database unreachable" from "not registered" in the reply a user gets when account lookup fails |
| `audio-document-router.js` | Classifies audio sent as a WhatsApp document (up to 100 MB) so long classroom recordings are routed, not rejected |
| `child-test.handler.js` | Router entry points for the EGRA/EGMA child test; inert unless CHILD_TEST_ENABLED and coach/leader in ICT (bd-s1oo0.4) |
| `coaching-trigger.js` | Pure helper deciding when a typed /coaching command starts the classroom-coaching hot-trigger |
| `exam-checker.handler.js` | Routes exam-checker text, image, button and Flow messages to the Exam Checker orchestrator |
| `flow-response.handler.js` | Routes WhatsApp Flow NFM_REPLY submissions to per-flow processors (registration, settings, reading, observe) |
| `homework-trigger.js` | Pure helper deciding when a bare "homework"/"hw" message fires the homework Flow without colliding with LP trigger |
| `hos-broadcast-video.js` | Replies to head-of-school broadcast template button taps with the feature video in the open window (bd-07cjd) |
| `image-message.handler.js` | Handles inbound images: coaching photo collection, roster, exam and vision analysis in a fixed routing order |
| `lesson-plan-v2.handler.js` | Serves curriculum lesson plans from pre_generated_lps (R2 PDF) or curriculum_lp_ast (Gamma render, cached) |
| `observe-command.handler.js` | /observe command: gates region/account/role, onboarding, opens the visit Flow and sets capture state (FEAT-053) |
| `observe-visit-flow.handler.js` | Observe-visit Flow endpoint: school/teacher picker and scheduling UI behind OBSERVE_SCHEDULING_UI (bd-2430/2431/2443) |
| `portal-command.handler.js` | /portal command: sends a signed one-tap login link into the teacher portal (bd-x7aprz.3) |
| `remark-command.handler.js` | /remark command for supervisor remarks (STEPS S): gate order, roster build, handled-or-fall-through (bd-2531) |
| `roster-command.js` | /roster command extracted from the text handler so its gates and copy are testable |
| `text-message.handler.js` | Main inbound text router (167 KB): slash commands, hot-triggers, menus, LP serve, then chat LLM fallback |
| `video-command.js` | Pure matcher for the video-library command, accepting /video, /videos and bare "video" |
| `voice-message.handler.js` | Inbound voice-note pipeline: per-note staging dir (bd-x74wv), transcription, voice LP requests, recording routing |
| `welcome.handler.js` | Handles Meta's request_welcome message when a user first opens the chat, sending the welcome (bd-oak77.13) |

## Who reads this (all, generated)
- `account-state-reply.js` ← imported by `bot/shared/handlers/text-message.handler.js:530:4046c864`
- `audio-document-router.js` ← imported by `bot/whatsapp-bot.js:2509:fcd74f2b`
- `child-test.handler.js` ← imported by `bot/whatsapp-bot.js:788:4b71e214` · `bot/shared/handlers/image-message.handler.js:90:ac30d1c9` · `bot/shared/handlers/text-message.handler.js:980:ac30d1c9` · `bot/shared/handlers/voice-message.handler.js:105:ac30d1c9`
- `coaching-trigger.js` ← imported by `bot/shared/handlers/text-message.handler.js:212:82077e04`
- `exam-checker.handler.js` ← imported by `bot/whatsapp-bot.js:54:ca546162` · `bot/shared/handlers/flow-response.handler.js:129:f343c294` · `bot/shared/handlers/image-message.handler.js:158:f343c294` · `bot/shared/handlers/text-message.handler.js:955:f343c294`
- `flow-response.handler.js` ← imported by `bot/whatsapp-bot.js:1717:edad08fd`
- `homework-trigger.js` ← imported by `bot/shared/handlers/text-message.handler.js:211:ae25a601`
- `hos-broadcast-video.js` ← imported by `bot/whatsapp-bot.js:29:7c2c0de1`
- `image-message.handler.js` ← imported by `bot/whatsapp-bot.js:33:628aef62`
- `lesson-plan-v2.handler.js` ← imported by `bot/scripts/render/smoke-gamma-grounded-async.js:75:9dd810fb` · `bot/scripts/render/smoke-gamma-grounded.js:60:9dd810fb` · `bot/shared/handlers/text-message.handler.js:34:d0e3c8d0`
- `observe-command.handler.js` ← imported by `bot/shared/services/menu.service.js:244:05d1cbb5` · `bot/shared/services/observe/observe-binding.service.js:235:10b50a6e` · `bot/whatsapp-bot.js:2406:f0f8f9fc` · `bot/shared/handlers/flow-response.handler.js:905:020a205f` (+1: `python3 kg/kg.py who-reads observe-command.handler.js`)
- `observe-visit-flow.handler.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:175:fe7ac137` · `bot/shared/handlers/flow-response.handler.js:742:54b30f6a` · `bot/shared/handlers/observe-command.handler.js:172:259cb7f7`
- `portal-command.handler.js` ← imported by `bot/shared/handlers/text-message.handler.js:26:625e6e99`
- `remark-command.handler.js` ← imported by `bot/whatsapp-bot.js:798:64d8c5ae` · `bot/shared/handlers/text-message.handler.js:1070:e314a5eb`
- `roster-command.js` ← imported by `bot/shared/handlers/text-message.handler.js:1136:d804b960`
- `text-message.handler.js` ← imported by `bot/shared/services/student-ingress.js:237:22b3f618` · `bot/whatsapp-bot.js:28:6f75c240`
- `video-command.js` ← imported by `bot/shared/handlers/text-message.handler.js:232:bd0bb31d`
- `voice-message.handler.js` ← imported by `bot/whatsapp-bot.js:32:bedba29b`
- `welcome.handler.js` ← imported by `bot/whatsapp-bot.js:673:f6715c94`
- column `coaching_sessions.status` (written by `text-message.handler.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/routes/observe2-check-endpoint.js:319:a2492b8c` · `bot/shared/services/coaching/analysis-processor.service.js:583:27c642b3` (+39: `python3 kg/kg.py who-reads coaching_sessions.status`)
- column `coaching_sessions.updated_at` (written by `text-message.handler.js`) ← read by `bot/shared/services/coaching/lp-coaching/lp-step.service.js:193:6d171412` · `bot/shared/services/coaching/portal-class-check.js:181:5720b09e` · `bot/shared/services/coaching/portal-coaching.service.js:354:fa39a4c5` · `bot/shared/services/observe/observe-debrief.service.js:301:4ae4d8f8` (+2: `python3 kg/kg.py who-reads coaching_sessions.updated_at`)
- column `reading_assessments.comprehension_answers` (written by `text-message.handler.js`, `voice-message.handler.js`) ← read by `bot/shared/services/redis-comprehension.service.js:85:64fad2d6`
- column `reading_assessments.comprehension_questions` (written by `text-message.handler.js`, `voice-message.handler.js`) ← read by `bot/shared/services/redis-comprehension.service.js:85:64fad2d6`
- column `reading_assessments.comprehension_requested` (written by `flow-response.handler.js`) ← read by `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.comprehension_score` (written by `text-message.handler.js`, `voice-message.handler.js`) ← read by `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.created_at` (written by `flow-response.handler.js`) ← read by `bot/shared/services/context.service.js:171:e8356999` · `bot/shared/services/feature-linker.service.js:376:095556e4` · `bot/shared/services/reading-assessment.service.js:30:491f9c89` · `bot/shared/services/redis-comprehension.service.js:85:64fad2d6` (+3: `python3 kg/kg.py who-reads reading_assessments.created_at`)
- column `reading_assessments.grade_level` (written by `flow-response.handler.js`) ← read by `bot/whatsapp-bot.js:1197:d5870428` · `dashboard/routes/portal.routes.js:8259:6033d135` · `bot/shared/handlers/text-message.handler.js:1735:28adfbcc` · `bot/shared/handlers/voice-message.handler.js:414:d5870428`
- column `reading_assessments.language` (written by `flow-response.handler.js`) ← read by `dashboard/routes/portal.routes.js:8259:6033d135` · `bot/shared/handlers/text-message.handler.js:1735:28adfbcc` · `bot/shared/handlers/voice-message.handler.js:324:41c35e65`
- column `reading_assessments.passage_type` (written by `flow-response.handler.js`) ← read by `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.status` (written by `flow-response.handler.js`, `text-message.handler.js`, `voice-message.handler.js`) ← read by `bot/shared/services/context.service.js:170:a69ef692` · `bot/shared/services/reading-assessment.service.js:29:a9e5e72d` · `bot/shared/services/redis-comprehension.service.js:85:64fad2d6` · `bot/workers/stale-session.worker.js:279:99a7da90` (+3: `python3 kg/kg.py who-reads reading_assessments.status`)
- column `reading_assessments.student_identifier` (written by `flow-response.handler.js`) ← read by `bot/shared/services/reading-assessment.service.js:27:0e45f86e` · `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.user_id` (written by `flow-response.handler.js`) ← read by `bot/shared/services/context.service.js:169:219f5683` · `bot/shared/services/feature-linker.service.js:377:219f5683` · `bot/shared/services/feature-registration.service.js:148:9437903a` · `bot/shared/services/reading-assessment.service.js:28:219f5683` (+5: `python3 kg/kg.py who-reads reading_assessments.user_id`)
- column `users.preferences` (written by `observe-command.handler.js`) ← read by `bot/shared/routes/settings-endpoint.js:49:f26864bf` · `bot/shared/services/coaching/frameworks/framework-selector.js:65:ff3cc75a` · `bot/shared/services/coaching/video-reco/clip-pref.js:49:03cf518a` · `dashboard/services/video-reco-events.js:64:b29a87bb` (+1: `python3 kg/kg.py who-reads users.preferences`)
- column `users.registration_completed` (written by `flow-response.handler.js`) ← read by `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/services/app-redirect.service.js:306:ae2bb76a` · `bot/shared/services/feature-registration.service.js:48:8579cb74` · `bot/shared/services/first-touch/teacher-home.data.js:67:67bade35` (+4: `python3 kg/kg.py who-reads users.registration_completed`)
- column `users.registration_pending_name` (written by `flow-response.handler.js`) ← read by `bot/shared/services/feature-registration.service.js:48:8579cb74`
- table `coaching_sessions` whole row (`*`) (written by `text-message.handler.js`) ← read by `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? · `bot/shared/services/coaching/analysis-processor.service.js:124:a23aff58`? · `bot/shared/services/coaching/coaching-session.service.js:196:5d974874`? (+9: `python3 kg/kg.py who-reads coaching_sessions`)
- table `reading_assessments` whole row (`*`) (written by `flow-response.handler.js`, `text-message.handler.js`, `voice-message.handler.js`) ← read by `bot/shared/services/feature-registration.service.js:147:7a0c163a`? · `bot/shared/services/reading/analysis.service.js:88:d2b02c3e`? · `bot/shared/services/reading/auto-level-orchestrator.service.js:167:d2b02c3e`? · `dashboard/database/queries.js:749:7a0c163a`? (+2: `python3 kg/kg.py who-reads reading_assessments`)
- table `users` whole row (`*`) (written by `flow-response.handler.js`, `observe-command.handler.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:314:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `coaching_sessions` (written by `text-message.handler.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/routes/observe-mewaka-endpoint.js:151:5911672a`? · `bot/shared/routes/observe2-check-endpoint.js:296:e8f4d550`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)
- table `reading_assessments` (written by `flow-response.handler.js`, `text-message.handler.js`, `voice-message.handler.js`) ← read by `bot/shared/services/context.service.js:165:4337985e`? · `bot/shared/services/feature-linker.service.js:375:4337985e`? · `bot/shared/services/feature-registration.service.js:146:4337985e`? · `bot/shared/services/reading-assessment.service.js:26:4337985e`? (+11: `python3 kg/kg.py who-reads reading_assessments`)
- table `users` (written by `flow-response.handler.js`, `observe-command.handler.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+169: `python3 kg/kg.py who-reads users`)
- env `EXAM_CHECKER_STUDENTS_FLOW_ID` read at `bot/shared/handlers/exam-checker.handler.js:297:2a981122` · `bot/shared/handlers/flow-response.handler.js:127:4263f443`
- env `HOMEWORK_FLOW_ID` read at `bot/shared/handlers/text-message.handler.js:2444:dbf221a0`
- env `LP_CONTEXT_V2_ENABLED` read at `bot/shared/handlers/text-message.handler.js:2884:83d13c62` · `bot/shared/handlers/voice-message.handler.js:1302:83d13c62`
- env `OBSERVE_OBS_ACTION` read at `bot/shared/handlers/observe-visit-flow.handler.js:414:dad41677`
- env `OBSERVE_SCHEDULING_UI` read at `bot/shared/handlers/observe-command.handler.js:256:9e3b4d82` · `bot/shared/handlers/observe-visit-flow.handler.js:39:4a859b60`
- env `OBSERVE_STAGE_SCREENS` read at `bot/shared/handlers/observe-visit-flow.handler.js:449:a8b0e040`
- env `OBSERVE_VISIT_FLOW_ID` read at `bot/shared/handlers/observe-command.handler.js:32:ce93551d`
- env `PAKISTAN_LP_FLOW_ID` read at `bot/shared/handlers/text-message.handler.js:1523:cbb066f0`
- env `READING_ASSESSMENT_FLOW_ID` read at `bot/shared/handlers/flow-response.handler.js:66:bd405b9f` · `bot/shared/handlers/text-message.handler.js:1215:59967b0b`
- env `REGISTRATION_AFTER_PLAN` read at `bot/shared/handlers/text-message.handler.js:2992:b3279845`
- env `REGISTRATION_FLOW_ID` read at `bot/shared/handlers/flow-response.handler.js:95:99a2307f`
- env `ROSTER_FLOW_ID` read at `bot/shared/handlers/roster-command.js:33:958ca8d6`
- env `SETTINGS_FLOW_ID` read at `bot/shared/handlers/text-message.handler.js:2304:34dda61d`
- env `STATUS_FLOW_ID` read at `bot/shared/handlers/text-message.handler.js:2377:66cea4be`
- env `TEACHER_TRAINING_FLOW_ID` read at `bot/shared/handlers/flow-response.handler.js:145:2fb83044`

## Tests (all, generated)
- `audio-document-router.js` ← `tests/coaching/document-audio-routing.test.js`
- `child-test.handler.js` ← `tests/child-test/L11/protocol.test.js` · `tests/child-test/L13/claim-and-cards.test.js` · `tests/child-test/L17/score-recovery.test.js` · `tests/child-test/L19/child-names.test.js` · `tests/child-test/L20/strip-matching.test.js` · `tests/child-test/L21/teacher-offer.test.js` (+9: `python3 kg/kg.py who-reads bot/shared/handlers/child-test.handler.js`)
- `coaching-trigger.js` ← `bot/tests/first-touch/maker.cards.test.js`
- `exam-checker.handler.js` ← `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/handlers/portal-bare-word.test.js`
- `flow-response.handler.js` ← `bot/tests/observe/visit-flow-wiring.test.js` · `bot/tests/observe/visit-scheduling-wiring.test.js` · `bot/tests/quiz/child-quiz-home.test.js` · `bot/tests/quiz/student-quiz-flow-endpoint.test.js` · `tests/assessment/assessment-chat-ack.test.js` · `tests/assessment/assessment-versions-completion.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/handlers/flow-response.handler.js`)
- `homework-trigger.js` ← `tests/homework/homework-flow.test.js`
- `hos-broadcast-video.js` ← `tests/broadcast/bd-07cjd-hos-video-buttons.test.js`
- `image-message.handler.js` ← `bot/tests/handlers/image-message.handler.test.js` · `bot/tests/observe/bd-2kxxa2-media-target.test.js` · `tests/child-test/L4/media-claim.test.js` · `tests/coaching/feat106-image-idempotency.test.js` · `tests/coaching/meta-bill-wamid-wiring.test.js`
- `lesson-plan-v2.handler.js` ← `bot/scripts/e2e/lp-feedback-e2e.js` · `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/handlers/lesson-plan-v2.handler.test.js` · `bot/tests/lp-v8/bd-oak77-route-all.test.js` · `tests/lesson-plan-lifecycle/grounded-path.test.js` · `tests/lesson-plan-lifecycle/pregen-artifact-ref.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/handlers/lesson-plan-v2.handler.js`)
- `observe-command.handler.js` ← `bot/tests/handlers/reversed-slash-command.test.js` · `bot/tests/observe/bd-jrxo3-no-bare-capture.test.js` · `bot/tests/observe/observe-command.handler.test.js` · `bot/tests/observe/visit-flow-wiring.test.js` · `bot/tests/observe/visit-scheduling-wiring.test.js` · `tests/child-test/L4/text-dispatch.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/handlers/observe-command.handler.js`)
- `observe-visit-flow.handler.js` ← `bot/tests/observe/bd-43530-picker-render.test.js` · `bot/tests/observe/bd-6cnaj-pending-feedback.test.js` · `bot/tests/observe/bd-88krt-visit-actions.test.js` · `bot/tests/observe/bd-9tqqi-raced-cancel-copy.test.js` · `bot/tests/observe/bd-bos31-names-and-paging.test.js` · `bot/tests/observe/bd-ej21x-obs-action.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/handlers/observe-visit-flow.handler.js`)
- `portal-command.handler.js` ← `bot/tests/handlers/portal-command-no-password.test.js` · `tests/portal/portal-command-go-link.test.js` · `tests/registration/front-door-invite.test.js`
- `remark-command.handler.js` ← `bot/tests/services/bd-gc1ge-remark-roster-nameless.test.js` · `bot/tests/services/remark-command-handler.test.js` · `bot/tests/services/remark-default-send.test.js` · `bot/tests/services/remark-wiring.test.js`
- `roster-command.js` ← `tests/registration/front-door-invite.test.js` · `tests/roster/roster-language.test.js`
- `text-message.handler.js` ← `bot/tests/first-touch/first-reply-english.text-turn.test.js` · `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/first-touch/one-door-child-word.test.js` · `bot/tests/first-touch/one-door-share-ref.test.js` · `bot/tests/first-touch/one-door-text-turn.test.js` · `bot/tests/first-touch/reg-after-plan-turn.test.js` (+38: `python3 kg/kg.py who-reads bot/shared/handlers/text-message.handler.js`)
- `video-command.js` ← `tests/handlers/feature-doors.test.js`
- `voice-message.handler.js` ← `bot/tests/bug-005-audio-document.test.js` · `tests/app-redirect/app-link-leader-lessons-voice-topic.test.js` · `tests/child-test/L4/media-claim.test.js` · `tests/handlers/bd-c5reix-doors-keep-recording.test.js` · `tests/handlers/bd-v0toag.56-test-school-recording-analysed.test.js` · `tests/handlers/short-recording-guidance.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/handlers/voice-message.handler.js`)
- `welcome.handler.js` ← `bot/tests/welcome/bd-oak77.13-request-welcome.test.js`

## Related (all, generated)
- skills: `reading-assessment`? · `registration`? · `whatsapp-flows`?
- docs: `bot/shared/CLAUDE.md`? · `docs/LP_PATHS.md`? · `docs/features/homework.md`? · `docs/features/pic-to-lp.md`? · `docs/features/quiz.md`? · `docs/migration/01-lesson-plans.md`? · `docs/student-mode.md`?
