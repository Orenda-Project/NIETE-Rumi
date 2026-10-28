# workers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/workers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `attendance-bigquery-export.worker.js` | Nightly cron exporting the last 24h teacher-presence rollup to the STEPS BigQuery warehouse |
| `exam-grading.worker.js` | SQS exam_grading job: OCR (Mistral, Chandra fallback), grading and annotation phases for an exam session |
| `homework-bundle.worker.js` | SQS homework_bundle_generation job: downloads chapter PDFs, pdf-lib merges one grade x subject bundle, delivers it |
| `lesson-plan-extraction.worker.js` | Worker class extracting lesson plans from uploaded textbook pages; strips NULs before DB writes (bd-0wws3e) |
| `lesson-plan-generation.worker.js` | SQS lesson-plan generation worker with retries, apology on max failures and free-form track routing |
| `lp612-author.worker.js` | SQS job authoring, rendering, storing and delivering a 6-12 lesson for one segment/lang/template version |
| `push-ticks.js` | Schedules the web-quiz reminder push due tick (60s) and expiry tick (6h); never throws |
| `quiz-job-handler.js` | SQS handlers for quiz_report/expire/nudge/reminder jobs with a Redis cancel-flag check |
| `quiz-retest-schedule.js` | Schedules the hourly day-3 quiz retest sweep on main-queue worker replicas (bd-v0toag.10) |
| `remark-narrative-retry.worker.js` | Railway cron sweeping supervisor remarks by status to retry narrative generation (bd-2531) |
| `sqs-worker.js` | Main SQS worker entry: long-polls queues and routes each jobType to its handler with visibility heartbeats |
| `sqs-worker.railway.toml` | Railway config for the SQS worker service: nixpacks build, starts node workers/sqs-worker.js |
| `stale-session.worker.js` | 15-minute Railway cron sweeping stuck coaching sessions: reminders, auto-complete, recovery |
| `video-generation.worker.js` | SQS video job: script, TTS, images, clips, assembly and delivery with checkpoint/resume |

## Who reads this (all, generated)
- `exam-grading.worker.js` ← imported by `bot/workers/sqs-worker.js:42:ca746dc3`
- `homework-bundle.worker.js` ← imported by `bot/workers/sqs-worker.js:628:0d2d9250`
- `lesson-plan-extraction.worker.js` ← imported by `bot/shared/services/observe/observe2/added-plan.js:49:5dcbcd5c` · `bot/workers/sqs-worker.js:39:9c52ae35`
- `lesson-plan-generation.worker.js` ← imported by `bot/scripts/render/smoke-gamma-grounded-async.js:76:c2f89091` · `bot/workers/sqs-worker.js:40:da59a648`
- `lp612-author.worker.js` ← imported by `bot/workers/sqs-worker.js:719:de2068ae`
- `push-ticks.js` ← imported by `bot/workers/sqs-worker.js:1755:29f8edc7`
- `quiz-job-handler.js` ← imported by `bot/workers/sqs-worker.js:738:7c80559f`
- `quiz-retest-schedule.js` ← imported by `bot/workers/sqs-worker.js:1766:331e8640`
- `stale-session.worker.js` ← imported by `bot/workers/sqs-worker.js:1956:2acbf1dd`
- `video-generation.worker.js` ← imported by `bot/workers/sqs-worker.js:41:68faed42`
- column `coaching_sessions.analysis_data` (written by `stale-session.worker.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` · `bot/shared/routes/observe2-check-endpoint.js:297:ed6f6cd9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+32: `python3 kg/kg.py who-reads coaching_sessions.analysis_data`)
- column `coaching_sessions.conversation_state` (written by `stale-session.worker.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:85:739d5912` · `bot/shared/services/coaching/classroom-photo/capture.service.js:164:0125d837` · `bot/shared/services/coaching/classroom-photo/photo-yes.service.js:57:e9871896` (+8: `python3 kg/kg.py who-reads coaching_sessions.conversation_state`)
- column `coaching_sessions.status` (written by `sqs-worker.js`, `stale-session.worker.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1923:21a55915` · `bot/shared/handlers/voice-message.handler.js:744:21a55915` (+40: `python3 kg/kg.py who-reads coaching_sessions.status`)
- column `coaching_sessions.updated_at` (written by `sqs-worker.js`, `stale-session.worker.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:193:6d171412` · `bot/shared/services/coaching/portal-class-check.js:181:5720b09e` · `bot/shared/services/coaching/portal-coaching.service.js:354:fa39a4c5` (+3: `python3 kg/kg.py who-reads coaching_sessions.updated_at`)
- column `lesson_plan_requests.status` (written by `homework-bundle.worker.js`) ← read by `bot/shared/services/lesson-plan-queue.service.js:342:184894e4` · `bot/shared/services/lp-v8-lifecycle.service.js:49:df52c07a` · `bot/shared/services/monitoring/lesson-plan-health.service.js:331:5809b3eb` · `bot/shared/services/teacher-state.service.js:94:28233e00`
- column `lesson_plans.content` (written by `homework-bundle.worker.js`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797`
- column `lesson_plans.grade` (written by `homework-bundle.worker.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+3: `python3 kg/kg.py who-reads lesson_plans.grade`)
- column `lesson_plans.quiz_nudge_sent` (written by `quiz-job-handler.js`) ← read by `bot/shared/services/quiz/quiz-scheduler.service.js:25:15306e2a`
- column `lesson_plans.subject` (written by `homework-bundle.worker.js`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797` (+2: `python3 kg/kg.py who-reads lesson_plans.subject`)
- column `lesson_plans.topic` (written by `homework-bundle.worker.js`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+4: `python3 kg/kg.py who-reads lesson_plans.topic`)
- column `lesson_plans.type` (written by `homework-bundle.worker.js`) ← read by `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `dashboard/database/queries.js:718:e125cbb9` · `dashboard/routes/portal.routes.js:2608:bfdc3284`
- column `lesson_plans.user_id` (written by `homework-bundle.worker.js`) ← read by `bot/shared/database/bot-helpers.js:413:219f5683` · `bot/shared/routes/quiz-flow-endpoint.js:160:219f5683` · `bot/shared/services/context.service.js:142:219f5683` · `bot/shared/services/feature-linker.service.js:363:219f5683` (+9: `python3 kg/kg.py who-reads lesson_plans.user_id`)
- column `quiz_sessions.status` (written by `quiz-job-handler.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:322:14a4b92a` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:304:66e5988e` · `bot/shared/services/quiz/quiz-delivery.service.js:144:83330cbc` · `bot/shared/services/quiz/quiz-insight.service.js:204:a69ef692` (+23: `python3 kg/kg.py who-reads quiz_sessions.status`)
- column `video_requests.completed_at` (written by `sqs-worker.js`, `video-generation.worker.js`) ← read by `dashboard/routes/portal.routes.js:8669:0b0b6afb`
- column `video_requests.generation_time_seconds` (written by `video-generation.worker.js`) ← read by `dashboard/routes/portal.routes.js:8669:0b0b6afb`
- column `video_requests.pdf_url` (written by `video-generation.worker.js`) ← read by `dashboard/routes/portal.routes.js:8669:0b0b6afb`
- column `video_requests.retry_count` (written by `sqs-worker.js`, `video-generation.worker.js`) ← read by `bot/workers/sqs-worker.js:1448:0df645b0` · `bot/workers/video-generation.worker.js:360:d2f49837`
- column `video_requests.slide_urls` (written by `video-generation.worker.js`) ← read by `dashboard/routes/portal.routes.js:8669:0b0b6afb`
- column `video_requests.started_at` (written by `video-generation.worker.js`) ← read by `bot/workers/sqs-worker.js:1450:96ebd749`
- column `video_requests.status` (written by `sqs-worker.js`, `video-generation.worker.js`) ← read by `bot/shared/services/context.service.js:184:a69ef692` · `bot/shared/services/feature-registration.service.js:155:abb6a119` · `dashboard/database/queries.js:742:a69ef692` · `dashboard/routes/portal.routes.js:8669:0b0b6afb` (+2: `python3 kg/kg.py who-reads video_requests.status`)
- column `video_requests.video_url` (written by `video-generation.worker.js`) ← read by `dashboard/routes/portal.routes.js:8669:0b0b6afb`
- table `coaching_sessions` whole row (`*`) (written by `lesson-plan-extraction.worker.js`, `sqs-worker.js`, `stale-session.worker.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+11: `python3 kg/kg.py who-reads coaching_sessions`)
- table `exam_check_sessions` whole row (`*`) (written by `exam-grading.worker.js`) ← read by `bot/shared/services/exam-checker/exam-session.service.js:33:d2b02c3e`?
- table `lesson_plan_requests` whole row (`*`) (written by `homework-bundle.worker.js`) ← read by `bot/scripts/requeue-lesson-plan.js:42:d2b02c3e`?
- table `lesson_plans` whole row (`*`) (written by `homework-bundle.worker.js`, `quiz-job-handler.js`) ← read by `bot/shared/services/feature-registration.service.js:135:7a0c163a`? · `dashboard/database/queries.js:717:7a0c163a`?
- table `video_requests` whole row (`*`) (written by `sqs-worker.js`, `video-generation.worker.js`) ← read by `bot/shared/services/feature-registration.service.js:153:7a0c163a`? · `bot/shared/services/video/video-session.service.js:145:3a0a473e`? · `dashboard/database/queries.js:741:7a0c163a`? · `dashboard/routes/portal.routes.js:8728:d2b02c3e`?
- table `coaching_sessions` (written by `lesson-plan-extraction.worker.js`, `sqs-worker.js`, `stale-session.worker.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- table `exam_check_sessions` (written by `exam-grading.worker.js`) ← read by `bot/shared/services/exam-checker/exam-session.service.js:32:3d8d7449`?
- table `lesson_plan_requests` (written by `homework-bundle.worker.js`) ← read by `bot/shared/routes/homework-request-endpoint.js:225:f61b5e94`? · `bot/shared/services/lesson-plan-queue.service.js:50:f61b5e94`? · `bot/shared/services/lp-v8-lifecycle.service.js:43:f61b5e94`? · `bot/shared/services/monitoring/lesson-plan-health.service.js:330:c661c05e`? (+2: `python3 kg/kg.py who-reads lesson_plan_requests`)
- table `lesson_plans` (written by `homework-bundle.worker.js`, `quiz-job-handler.js`) ← read by `bot/shared/database/bot-helpers.js:411:611f2601`? · `bot/shared/routes/quiz-flow-endpoint.js:158:611f2601`? · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:158:611f2601`? · `bot/shared/services/context.service.js:138:611f2601`? (+13: `python3 kg/kg.py who-reads lesson_plans`)
- table `niete_lp612_renders` (written by `lp612-author.worker.js`) ← read by `bot/shared/services/coaching/portal-lesson-plan-library.service.js:117:3534712c`?
- table `quiz_sessions` (written by `quiz-job-handler.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:144:a4d322ab`? · `bot/shared/handlers/text-message.handler.js:258:e211522c`? · `bot/shared/routes/quiz-flow-endpoint.js:321:e211522c`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:303:df117d27`? (+43: `python3 kg/kg.py who-reads quiz_sessions`)
- table `supervisor_remarks` (written by `remark-narrative-retry.worker.js`) ← read by `bot/shared/services/remark/remark-cycle.repository.js:118:e4257554`? · `bot/shared/services/remark/remark-delivery.deps.js:169:e4257554`? · `bot/shared/services/remark/remark-write.repository.js:41:e4257554`? · `dashboard/routes/portal.routes.js:1674:dec350bb`?
- table `video_requests` (written by `sqs-worker.js`, `video-generation.worker.js`) ← read by `bot/shared/services/context.service.js:179:31e6558b`? · `bot/shared/services/feature-registration.service.js:152:31e6558b`? · `bot/shared/services/video/video-animation.service.js:361:31e6558b`? · `bot/shared/services/video/video-assembly.service.js:208:31e6558b`? (+8: `python3 kg/kg.py who-reads video_requests`)
- env `GRACEFUL_SHUTDOWN_TIMEOUT` read at `bot/workers/sqs-worker.js:57:35941389`
- env `NODE_ENV` read at `bot/workers/sqs-worker.js:1695:f48a92b6`
- env `OBSERVE_DEBRIEF_RETRY_OFF` read at `bot/workers/sqs-worker.js:1621:de60831e`
- env `OBSERVE_UNDELIVERED_MAX_EXPIRE_PER_TICK` read at `bot/workers/stale-session.worker.js:901:3a09fb57`
- env `OBSERVE_UNDELIVERED_MAX_PER_TICK` read at `bot/workers/stale-session.worker.js:887:8589c69a`
- env `OBSERVE_UNDELIVERED_SWEEP_OFF` read at `bot/workers/stale-session.worker.js:996:154392f4`
- env `OBSERVE_UNTAPPED_MAX_PER_TICK` read at `bot/workers/stale-session.worker.js:686:e7faa092`
- env `OBSERVE_UNTAPPED_SWEEP_OFF` read at `bot/workers/stale-session.worker.js:781:7c351c01`
- env `OFFLINE_REPLAY` read at `bot/workers/lesson-plan-extraction.worker.js:704:2b87e4c7`
- env `PHOTO_GATE_SWEEP_MAX_AGE_DAYS` read at `bot/workers/stale-session.worker.js:1345:51941237`
- env `PHOTO_GATE_SWEEP_MAX_PER_TICK` read at `bot/workers/stale-session.worker.js:1344:e795cb90`
- env `QUEUE_DRIVER` read at `bot/workers/sqs-worker.js:269:df57a20a`
- env `QUIZ_FUNNEL_WATCH_ENABLED` read at `bot/workers/sqs-worker.js:2157:55a0344f`
- env `QUIZ_QUEUE_CONCURRENCY` read at `bot/workers/sqs-worker.js:286:9cebf5e6`
- env `QUIZ_QUEUE_OWN_LOOP` read at `bot/workers/sqs-worker.js:254:39bc885d`
- env `RAILWAY_REPLICA_ID` read at `bot/workers/sqs-worker.js:50:6815b5c0`
- env `REDIS_URL` read at `bot/workers/sqs-worker.js:271:a1aec4de`
- env `REMARK_RETRY_BATCH` read at `bot/workers/remark-narrative-retry.worker.js:40:7645a279`
- env `SQS_POLL_INTERVAL` read at `bot/workers/sqs-worker.js:56:db6ec9df`
- env `SQS_QUEUE_URL` read at `bot/workers/sqs-worker.js:1696:12dada91`
- env `SQS_QUIZ_QUEUE_URL` read at `bot/workers/sqs-worker.js:277:4a9c3772`
- env `SQS_VIDEO_QUEUE_URL` read at `bot/workers/sqs-worker.js:277:4a9c3772`
- env `SQS_WORKER_CONCURRENCY` read at `bot/workers/sqs-worker.js:52:daba8ce9`
- env `SQS_WORKER_HEALTH_PORT` read at `bot/workers/sqs-worker.js:1279:31b0e107`
- env `STALE_RECOVERY_INTERVAL_MINUTES` read at `bot/workers/sqs-worker.js:1961:7ee63401`
- env `TEACHER_NUDGES_SWEEP_MINUTES` read at `bot/workers/sqs-worker.js:2037:0ba28ff5`
- env `TEMP_DIR` read at `bot/workers/lesson-plan-generation.worker.js:58:89250f94`
- env `WORKER_QUEUES` read at `bot/workers/sqs-worker.js:234:e41588e6`

## Tests (all, generated)
- `attendance-bigquery-export.worker.js` ← `tests/attendance/bigquery-export-worker.test.js`
- `homework-bundle.worker.js` ← `tests/homework/homework-flow.test.js` · `tests/lesson-plan-lifecycle/homework-path.test.js`
- `lesson-plan-extraction.worker.js` ← `tests/coaching/bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js` · `tests/coaching/bd-fe35j9-urdu-pdf-vision-retry.test.js` · `tests/coaching/bd-we73k-pasted-lesson-plan.test.js` · `tests/coaching/lp-extraction-payload.test.js` · `tests/observe/bd-fmf24g.66-coach-plan-no-teacher-whatsapp.test.js`
- `lesson-plan-generation.worker.js` ← `bot/tests/lp-v8/bd-oak77-cutover-inflight.test.js` · `tests/app-redirect/app-link-leader-lessons-rescue.test.js` · `tests/fflp/queue-worker.test.js` · `tests/lesson-plan-lifecycle/generation-failed-attempts.test.js` · `tests/lesson-plan-lifecycle/grounded-path.test.js` · `tests/lesson-plan-lifecycle/requeue-grounded.test.js` (+1: `python3 kg/kg.py who-reads bot/workers/lesson-plan-generation.worker.js`)
- `lp612-author.worker.js` ← `tests/lesson-plan-lifecycle/lp612-leader.test.js` · `tests/lesson-plan-lifecycle/lp612-worker-portal.test.js` · `tests/lp612/author-worker.test.js` · `tests/lp612/bd-oak77-11-checkpoint.test.js` · `tests/lp612/cost-names-the-lesson.test.js` · `tests/lp612/family-worker-wiring.test.js` (+15: `python3 kg/kg.py who-reads bot/workers/lp612-author.worker.js`)
- `push-ticks.js` ← `bot/tests/push/web-quiz-push.routes.test.js`
- `quiz-job-handler.js` ← `bot/tests/quiz/chat-quiz-report-send-checked.test.js` · `bot/tests/quiz/report-delivery-send.test.js` · `tests/quiz/quiz-job-handler.test.js`
- `quiz-retest-schedule.js` ← `tests/quiz/quiz-retest-schedule.test.js`
- `sqs-worker.js` ← `bot/tests/lp-v8/lp-coaching-ask-worker-wiring.test.js` · `bot/tests/nudges/teacher-nudges-sqs-worker-wiring.test.js` · `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` · `bot/tests/quiz/lp-quiz-offer-worker-wiring.test.js` · `bot/tests/quiz/web-quiz/challenge-clip-warm.test.js` · `bot/tests/workers/bd-2kxxa3-debrief-retry-sweep-glue.test.js` (+22: `python3 kg/kg.py who-reads bot/workers/sqs-worker.js`)
- `stale-session.worker.js` ← `bot/tests/observe/bd-go4tl-midflight-observe.test.js` · `bot/tests/observe/bd-mwn4j-untapped-projection.test.js` · `bot/tests/observe/bd-tju8f-sweep-observer.test.js` · `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` · `bot/tests/workers/bd-gc1ge-photo-gate-greeting.test.js` · `bot/tests/workers/undelivered-sweep.test.js` (+5: `python3 kg/kg.py who-reads bot/workers/stale-session.worker.js`)

## Related (all, generated)
- skills: `coaching`? · `video-generation`?
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/nudges/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/push/CLAUDE.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/workers/CLAUDE.index.md`? · `bot/workers/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/LP_PATHS.md`? · `docs/agent-customization.md`? · `docs/architecture.md`? · `docs/attendance-bigquery-sync.md`? · `docs/e2e-mock-lane.md`? · `docs/features/CLAUDE.index.md`? · `docs/features/homework.md`? · `docs/features/quiz.md`? · `docs/features/video-quiz.md`? · `docs/reports/CLAUDE.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `docs/roadmap/audio-lp.md`? · `tests/app-redirect/CLAUDE.index.md`? · `tests/app-redirect/CLAUDE.md`? · `tests/attendance/CLAUDE.index.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/fflp/CLAUDE.md`? · `tests/homework/CLAUDE.md`? · `tests/lesson-plan-lifecycle/CLAUDE.index.md`? · `tests/lp612/CLAUDE.index.md`? · `tests/observe/CLAUDE.index.md`? · `tests/observe/CLAUDE.md`? · `tests/quiz/CLAUDE.index.md`?
- service: `sqs-worker.railway.toml` · `worker`
