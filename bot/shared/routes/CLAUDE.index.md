# routes — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/routes -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `assessment-gen-endpoint.js` | Server-driven Assessment Generator Flow: CLASS, COVERAGE, QUESTIONS/PAGES, CONFIRM with Redis session state |
| `attendance-marking-endpoint.js` | Encrypted Flow endpoint for marking attendance by teacher tap, principal tap or voice review (CLASS to SAVED) |
| `attendance-setup-endpoint.js` | Encrypted Flow endpoint for attendance class setup; teacher pastes whole roster, parsed server-side |
| `child-test-app.routes.js` | /api/internal/child-test/* routes relaying the portal coach app's child test to app-api.service (bd-s1oo0.7) |
| `child-test-check-endpoint.js` | POST /api/flows/child-test-check Flow: coach reviews and edits AI marks for Urdu, English, Maths blocks |
| `class-manager-endpoint.js` | Class manager Flow endpoint (CLASSES, ADD, SUBJECTS, SAVED): view and add a teacher's classes |
| `class-round-internal.routes.js` | /api/internal/tr/round/* routes for the class round's locked mode on the teacher's phone (web_quiz_class_round) |
| `edit-class-endpoint.js` | Edit-class Flow endpoint: add (paste parser), remove or rename students on an existing class roster |
| `exam-confirm-endpoint.js` | Exam-Checker "Confirm Students" Flow endpoint; flow token is the exam session id, shows detected students |
| `flow-endpoint.routes.js` | Express router for encrypted WhatsApp Flow data exchange; dispatches by flow to the per-flow endpoint handlers |
| `homework-request-endpoint.js` | Homework request Flow endpoint: grade, subject, chapters selection that enqueues homework_bundle_generation jobs |
| `internal-api.routes.js` | Internal service-to-service API (/api/internal, x-api-key) used by the portal: LP enqueue, training, classes etc. |
| `internal-assessment-edit.routes.js` | Five thin internal routes for the portal to edit a generated paper via the editor service |
| `internal-assessment-view.routes.js` | Internal route returning a finished paper's questions for the portal paper page (bd-fmf24g.31) |
| `internal-attendance.routes.js` | Internal routes for teacher-portal attendance: classes, roster, mark (bd-fmf24g.7) |
| `internal-fln-send.routes.js` | POST /api/internal/fln/send: resolves teachers' phone/language in the bot and queues an FLN plan send |
| `internal-share.routes.js` | POST /api/internal/share/send: portal asks the bot to send a shared item, returning the real send status (bd-fmf24g.30) |
| `observe-mewaka-endpoint.js` | data_exchange endpoint for the editable MEWAKA Flow that reads a pre-computed draft and buffers coach edits (FEAT-053) |
| `observe2-check-endpoint.js` | /observe2 check Flow endpoint: coach confirms moments heard in the recording, saved per screen |
| `observe2-form-endpoint.js` | /observe2 live field-form Flow endpoint: PART_ONE onward with rule validation and per-screen saves |
| `pakistan-lp-endpoint.js` | Lesson Plan Flow endpoint (grade, subject, chapter, topic) routing grades 1-5 to pre_generated_lps and 6+ to Oxbridge |
| `pakistan-lp-telemetry.js` | Response-side logging and cap-breach detection for the LP Flow endpoint after a "Something went wrong" (bd-oak77.26) |
| `quiz-flow-endpoint.js` | Quiz Flow endpoint: shows active quizzes with progress, sends a new quiz or cancels one |
| `registration-endpoint.js` | Registration Flow v5 endpoint (name/language, role+school, school pick, teaching) persisting to users (bd-x7aprz.2) |
| `remark-endpoint.js` | /remark Supervisor Remark Flow endpoint: PICK_TEACHER, RUBRIC, SUCCESS (bd-2712) |
| `roster-flow-endpoint.js` | /roster Flow endpoint: school, register photos, class, review, saved, plus edit/teacher/merge screens |
| `settings-endpoint.js` | Settings Flow endpoint (SETTINGS_MAIN to SUCCESS): language and observation framework preference |
| `status-flow-endpoint.js` | /status Flow endpoint listing active quizzes, coaching, LPs, video, reading and attendance, with cancel |
| `story-teacher-internal.routes.js` | Internal routes behind the portal's teacher Stories page: shelf, preview, share a storybook to a class |
| `student-quiz-flow-endpoint.js` | The child's /quiz Flow endpoint with its own childpick token, sq_action and sq* strings (bd-2yyry.13) |
| `student-videos-endpoint.js` | Student Videos Flow v2.0 endpoint: grade, subject, topic dropdowns that deliver a video (bd-1598) |
| `teacher-class-week-internal.routes.js` | Class-week card forward route: 302 to wa.me and one-time week_forwarded_at stamp (switch web_quiz_class_week) |
| `teacher-jugnu-internal.routes.js` | Teacher's Jugnu tab routes on /api/internal/tr: tab extras, forward link, queue actions (web_quiz_teacher_jugnu) |
| `teacher-report-internal.routes.js` | /api/internal/tr/*: teacher web-quiz report page and PDF, authorised only by the signed report token |
| `teacher-training-endpoint.js` | Teacher Training Flow endpoint: vendor picker, training home level cards, level detail with modules and grand quiz |
| `training-msq-endpoint.js` | One generic Flow endpoint serving every select-all-that-apply training question from the attempt in the token |
| `transcript-quiz-flow-endpoint.js` | /quiz Flow endpoint (LESSONS, LESSON, DONE): lesson list, live results and actions, all via data_exchange |
| `web-quiz-class-link.routes.js` | /api/internal/wq/cl/* routes for the standing class link landing, arrive and teacher step; 404 when switch off |
| `web-quiz-internal.routes.js` | /api/internal/wq/* routes for the web child quiz, forwarded by the portal; logic lives in web-quiz.service |

## Who reads this (all, generated)
- `assessment-gen-endpoint.js` ← imported by `bot/shared/handlers/flow-response.handler.js:1076:f26aaaa5` · `bot/shared/routes/flow-endpoint.routes.js:99:c504850d`
- `attendance-marking-endpoint.js` ← imported by `bot/shared/handlers/voice-message.handler.js:207:70b1b9d8` · `bot/shared/services/attendance-portal.service.js:231:31792ed6` · `bot/shared/routes/flow-endpoint.routes.js:23:21407e82`
- `attendance-setup-endpoint.js` ← imported by `bot/shared/routes/edit-class-endpoint.js:16:c48898bc` · `bot/shared/routes/flow-endpoint.routes.js:31:04047618`
- `child-test-app.routes.js` ← imported by `bot/shared/routes/internal-api.routes.js:2973:035459fa`
- `child-test-check-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:264:61a47844`
- `class-manager-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:40:674712ff` · `bot/shared/routes/internal-api.routes.js:870:c9308276`
- `class-round-internal.routes.js` ← imported by `bot/shared/routes/teacher-report-internal.routes.js:381:91363601`
- `edit-class-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:27:b2049111`
- `exam-confirm-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:89:f65ee467`
- `flow-endpoint.routes.js` ← imported by `bot/whatsapp-bot.js:74:d7fbe472`
- `homework-request-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:74:25e6b28a`
- `internal-api.routes.js` ← imported by `bot/whatsapp-bot.js:97:1d86e7c5`
- `internal-assessment-edit.routes.js` ← imported by `bot/shared/routes/internal-api.routes.js:2026:003972a3`
- `internal-assessment-view.routes.js` ← imported by `bot/shared/routes/internal-api.routes.js:2028:709cea0b`
- `internal-attendance.routes.js` ← imported by `bot/shared/routes/internal-api.routes.js:2030:39a302ca`
- `internal-fln-send.routes.js` ← imported by `bot/shared/routes/internal-api.routes.js:2033:617e0662`
- `internal-share.routes.js` ← imported by `bot/shared/routes/internal-api.routes.js:2032:b5701d16`
- `observe-mewaka-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:17:83181884`
- `observe2-check-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:244:8b919590`
- `observe2-form-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:211:c6cd7916`
- `pakistan-lp-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:104:c2320130`
- `pakistan-lp-telemetry.js` ← imported by `bot/shared/routes/pakistan-lp-endpoint.js:60:90f7c5d5`
- `quiz-flow-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:79:bad578f0`
- `registration-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:45:86ecb70b`
- `remark-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:54:408b6908`
- `roster-flow-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:35:fe03cf45`
- `settings-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:50:1dc88f9e`
- `status-flow-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:59:4be5d08d`
- `story-teacher-internal.routes.js` ← imported by `bot/whatsapp-bot.js:91:081d037f`
- `student-quiz-flow-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:1028:8110cd15`
- `student-videos-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:64:5e16580d`
- `teacher-class-week-internal.routes.js` ← imported by `bot/shared/routes/teacher-jugnu-internal.routes.js:26:7a036f82`
- `teacher-jugnu-internal.routes.js` ← imported by `bot/shared/routes/teacher-report-internal.routes.js:35:576e7567`
- `teacher-report-internal.routes.js` ← imported by `bot/whatsapp-bot.js:89:caceaeec`
- `teacher-training-endpoint.js` ← imported by `bot/shared/services/training/content-delivery.service.js:634:04257baa` · `bot/shared/services/training/quiz-delivery.service.js:445:a60b25cc` · `scripts/smoke-test-training-flow.js:17:c9f6adc0` · `bot/shared/routes/flow-endpoint.routes.js:94:ffb751b4` (+1: `python3 kg/kg.py who-reads teacher-training-endpoint.js`)
- `training-msq-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:84:b54f59fd`
- `transcript-quiz-flow-endpoint.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:69:a66341c9`
- `web-quiz-class-link.routes.js` ← imported by `bot/shared/routes/web-quiz-internal.routes.js:429:c54db84d`
- `web-quiz-internal.routes.js` ← imported by `bot/whatsapp-bot.js:87:461117d3`
- column `lesson_plan_requests.status` (written by `homework-request-endpoint.js`) ← read by `bot/shared/services/lesson-plan-queue.service.js:342:184894e4` · `bot/shared/services/lp-v8-lifecycle.service.js:49:df52c07a` · `bot/shared/services/monitoring/lesson-plan-health.service.js:331:5809b3eb` · `bot/shared/services/teacher-state.service.js:94:28233e00`
- column `lesson_plan_requests.topic` (written by `homework-request-endpoint.js`) ← read by `bot/shared/services/teacher-state.service.js:252:6012f2a7`
- column `lesson_plan_requests.user_id` (written by `homework-request-endpoint.js`) ← read by `bot/shared/services/lp-v8-lifecycle.service.js:45:219f5683` · `bot/shared/services/monitoring/lesson-plan-health.service.js:344:b19b951d` · `bot/shared/services/teacher-state.service.js:95:219f5683`
- column `student_lists.academic_year` (written by `attendance-setup-endpoint.js`) ← read by `bot/shared/services/classes/class.service.js:207:329e027c`
- column `student_lists.class_name` (written by `attendance-setup-endpoint.js`) ← read by `bot/shared/services/attendance-portal.service.js:244:99d94161` · `bot/shared/services/attendance-register-delivery.service.js:100:97085a82` · `bot/shared/services/attendance-router.service.js:88:99d94161` · `bot/shared/services/classes/class.service.js:207:329e027c` (+15: `python3 kg/kg.py who-reads student_lists.class_name`)
- column `student_lists.section` (written by `attendance-setup-endpoint.js`) ← read by `bot/shared/services/attendance-portal.service.js:244:99d94161` · `bot/shared/services/attendance-register-delivery.service.js:100:97085a82` · `bot/shared/services/attendance-router.service.js:88:99d94161` · `bot/shared/services/quiz/quiz-orchestrator.service.js:44:68c7e306` (+11: `python3 kg/kg.py who-reads student_lists.section`)
- column `student_lists.user_id` (written by `attendance-setup-endpoint.js`) ← read by `bot/shared/services/attendance-portal.service.js:246:219f5683` · `bot/shared/services/attendance-router.service.js:89:219f5683` · `bot/shared/services/classes/class.service.js:207:329e027c` · `bot/shared/services/coaching/video-reco/store.js:109:156b265d` (+13: `python3 kg/kg.py who-reads student_lists.user_id`)
- column `students.is_active` (written by `edit-class-endpoint.js`) ← read by `bot/shared/services/attendance-register-delivery.service.js:121:3d987916` · `bot/shared/services/attendance-router.service.js:128:f8c426e2` · `bot/shared/services/child-test/store.js:109:2a331b02` · `bot/shared/services/classes/class.service.js:858:c0410edf` (+23: `python3 kg/kg.py who-reads students.is_active`)
- column `students.student_name` (written by `edit-class-endpoint.js`) ← read by `bot/shared/services/attendance-register-delivery.service.js:111:1715c2d9` · `bot/shared/services/child-test/check-flow/check-store.js:157:651ac2c6` · `bot/shared/services/child-test/store.js:109:2a331b02` · `bot/shared/services/classes/class.service.js:858:c0410edf` (+27: `python3 kg/kg.py who-reads students.student_name`)
- column `users.preferences` (written by `settings-endpoint.js`) ← read by `bot/shared/handlers/flow-response.handler.js:761:6d7fc8d6` · `bot/shared/services/coaching/frameworks/framework-selector.js:65:ff3cc75a` · `bot/shared/services/coaching/video-reco/clip-pref.js:49:03cf518a` · `dashboard/services/video-reco-events.js:64:b29a87bb`
- table `lesson_plan_requests` whole row (`*`) (written by `homework-request-endpoint.js`) ← read by `bot/shared/services/lesson-plan-queue.service.js:320:d2b02c3e`? · `bot/scripts/requeue-lesson-plan.js:42:d2b02c3e`?
- table `student_lists` whole row (`*`) (written by `attendance-setup-endpoint.js`, `edit-class-endpoint.js`) ← read by `bot/shared/services/student-list.service.js:263:d2b02c3e`?
- table `students` whole row (`*`) (written by `attendance-setup-endpoint.js`, `edit-class-endpoint.js`) ← read by `bot/shared/services/student-list.service.js:362:d2b02c3e`?
- table `users` whole row (`*`) (written by `settings-endpoint.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:313:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `coaching_sessions` (written by `observe2-check-endpoint.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)
- table `lesson_plan_requests` (written by `homework-request-endpoint.js`) ← read by `bot/shared/services/lesson-plan-queue.service.js:50:f61b5e94`? · `bot/shared/services/lp-v8-lifecycle.service.js:43:f61b5e94`? · `bot/shared/services/monitoring/lesson-plan-health.service.js:330:c661c05e`? · `bot/shared/services/teacher-state.service.js:93:f61b5e94`? (+2: `python3 kg/kg.py who-reads lesson_plan_requests`)
- table `student_lists` (written by `attendance-setup-endpoint.js`, `edit-class-endpoint.js`) ← read by `bot/shared/services/attendance-portal.service.js:243:8479d615`? · `bot/shared/services/attendance-register-delivery.service.js:100:97085a82`? · `bot/shared/services/attendance-router.service.js:87:8479d615`? · `bot/shared/services/classes/class.service.js:206:8479d615`? (+24: `python3 kg/kg.py who-reads student_lists`)
- table `students` (written by `attendance-setup-endpoint.js`, `edit-class-endpoint.js`) ← read by `bot/shared/services/attendance-register-delivery.service.js:111:1715c2d9`? · `bot/shared/services/attendance-router.service.js:125:2f35b0c2`? · `bot/shared/services/child-test/check-flow/check-store.js:157:651ac2c6`? · `bot/shared/services/child-test/store.js:107:70f88e69`? (+42: `python3 kg/kg.py who-reads students`)
- table `users` (written by `registration-endpoint.js`, `settings-endpoint.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+169: `python3 kg/kg.py who-reads users`)
- table `video_quiz_deliveries` (written by `student-videos-endpoint.js`) ← read by `bot/shared/services/quiz/video-quiz.service.js:196:46908910`?
- env `INTERNAL_API_KEY` read at `bot/shared/routes/child-test-app.routes.js:27:72cfc094`
- env `REGION_TIME_ZONE` read at `bot/shared/routes/attendance-marking-endpoint.js:51:46900523`
- env `SUPABASE_URL` read at `bot/shared/routes/teacher-training-endpoint.js:46:34d32b0a`

## Tests (all, generated)
- `assessment-gen-endpoint.js` ← `tests/assessment/assessment-answer-key-always.test.js` · `tests/assessment/assessment-chapter-cap.test.js` · `tests/assessment/assessment-chat-ack.test.js` · `tests/assessment/assessment-counts-seen-and-legacy.test.js` · `tests/assessment/assessment-docx-flag.test.js` · `tests/assessment/assessment-edit-findable.test.js` (+18: `python3 kg/kg.py who-reads bot/shared/routes/assessment-gen-endpoint.js`)
- `attendance-marking-endpoint.js` ← `tests/attendance/absent-then-leave.test.js` · `tests/attendance/class-screen-query-cost.test.js` · `tests/attendance/completion-classified-from-token.test.js` · `tests/attendance/empty-roster-dead-end.test.js` · `tests/attendance/empty-roster-renders.test.js` · `tests/attendance/enrollment-roster-source.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/routes/attendance-marking-endpoint.js`)
- `attendance-setup-endpoint.js` ← `tests/attendance/class-setup-endpoint.test.js` · `tests/classes/academic-sessions.test.js`
- `child-test-app.routes.js` ← `tests/child-test/L7/app-internal.routes.test.js`
- `child-test-check-endpoint.js` ← `tests/child-test/L14/check-play.test.js` · `tests/child-test/L21/check-message.test.js` · `tests/child-test/L6/endpoint.test.js`
- `class-manager-endpoint.js` ← `tests/attendance/completion-classified-from-token.test.js` · `tests/classes/class-display.test.js` · `tests/classes/class-manager-endpoint.test.js` · `tests/classes/one-edit-screen.test.js` · `tests/classes/roster-add-failure-named.test.js` · `tests/classes/roster-empty-class.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/routes/class-manager-endpoint.js`)
- `edit-class-endpoint.js` ← `tests/attendance/edit-class-enrolls.test.js` · `tests/database/bd-rbtpr-ledger-gaps.test.js`
- `exam-confirm-endpoint.js` ← `tests/exam-checker/confirm-students-flow.test.js`
- `homework-request-endpoint.js` ← `tests/homework/homework-flow.test.js` · `tests/lesson-plan-lifecycle/homework-path.test.js`
- `internal-api.routes.js` ← `tests/assessment/fde-chain.test.js` · `tests/assessment/fde-create-race.test.js` · `tests/assessment/fde-create.test.js` · `tests/assessment/fde-options.test.js` · `tests/assessment/fde-status-versions.test.js` · `tests/assessment/golden.test.js` (+31: `python3 kg/kg.py who-reads bot/shared/routes/internal-api.routes.js`)
- `internal-assessment-edit.routes.js` ← `tests/assessment/assessment-edit-routes.test.js` · `tests/assessment/fde-edit-marks.test.js` · `tests/assessment/fde-edit.test.js` · `tests/assessment/fde-status-versions.test.js`
- `internal-assessment-view.routes.js` ← `tests/assessment/assessment-paper-view-routes.test.js`
- `internal-fln-send.routes.js` ← `tests/portal/fln-send-routes.test.js` · `tests/routes/internal-fln-send.test.js`
- `observe-mewaka-endpoint.js` ← `bot/tests/observe/bd-9tqqi-cancel-terminal.test.js` · `bot/tests/observe/bd-rw4so-endpoint-refusal-logged.test.js` · `bot/tests/observe/observe-endpoint-hots.test.js` · `bot/tests/observe/observe-endpoint.test.js` · `tests/whatsapp/send-sync-budget.test.js`
- `observe2-check-endpoint.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/observe2/check-endpoint.test.js` · `tests/observe2/coach-notes-brief.test.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/heard-empty.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/routes/observe2-check-endpoint.js`)
- `observe2-form-endpoint.js` ← `tests/observe2/classroom-photos.test.js` · `tests/observe2/coach-notes-form.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/form-endpoint.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js` · `tests/observe2/materials-used.test.js` (+9: `python3 kg/kg.py who-reads bot/shared/routes/observe2-form-endpoint.js`)
- `pakistan-lp-endpoint.js` ← `bot/tests/lp-v8/bd-oak77-endpoint-route-all.test.js` · `bot/tests/lp-v8/endpoint-dispatch.test.js` · `bot/tests/lp-v8/flow-response-telemetry.test.js` · `bot/tests/lp-v8/tick-app-opens.test.js` · `tests/lesson-plan-lifecycle/legacy-lanes.test.js` · `tests/lesson-plan-lifecycle/v8-ab-group.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/routes/pakistan-lp-endpoint.js`)
- `pakistan-lp-telemetry.js` ← `bot/tests/lp-v8/flow-response-telemetry.test.js`
- `quiz-flow-endpoint.js` ← `bot/tests/quiz/web-quiz/story-teacher.test.js` · `tests/quiz/quiz-flow-endpoint.test.js`
- `registration-endpoint.js` ← `bot/tests/registration/bd-2404-role-persistence.test.js` · `bot/tests/registration/bd-2480-2773-persist-per-screen.test.js` · `tests/registration/bd-oak77-6-completion-sets-flag.test.js` · `tests/registration/bd-x7aprz2-flow-v5-json.test.js` · `tests/registration/bd-x7aprz2-registration-v5.test.js` · `tests/registration/bd-x7aprz9-finish-closes-flow.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/routes/registration-endpoint.js`)
- `remark-endpoint.js` ← `bot/tests/services/remark-init-roster.test.js` · `tests/remark/remark-flow-contract.test.js`
- `roster-flow-endpoint.js` ← `tests/database/bd-a21ks-actor-ledger.test.js` · `tests/roster/roster-class-details.test.js` · `tests/roster/roster-class-teacher-required.test.js` · `tests/roster/roster-edit-save-identity.test.js` · `tests/roster/roster-endpoint-save.test.js` · `tests/roster/roster-endpoint-status.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/routes/roster-flow-endpoint.js`)
- `settings-endpoint.js` ← `tests/settings/settings-flow.test.js` · `tests/settings/settings-language-writer.test.js`
- `status-flow-endpoint.js` ← `tests/status/status-flow.test.js` · `tests/status/status-lp612-visibility.test.js` · `tests/status/status-task-count.test.js` · `tests/status/status-training-visibility.test.js`
- `story-teacher-internal.routes.js` ← `bot/tests/quiz/web-quiz/story-teacher-page-csp.test.js` · `bot/tests/quiz/web-quiz/story-teacher.test.js`
- `student-quiz-flow-endpoint.js` ← `bot/tests/quiz/student-quiz-flow-endpoint.test.js`
- `student-videos-endpoint.js` ← `bot/tests/quiz/web-quiz/video-bank-order.test.js` · `bot/tests/routes/student-videos-endpoint-child.test.js` · `bot/tests/routes/student-videos-endpoint.test.js` · `tests/quiz/child-quiz-fewer-bubbles.test.js` · `tests/student-videos/student-videos-flow.test.js` · `tests/whatsapp/send-sync-budget.test.js`
- `teacher-report-internal.routes.js` ← `bot/tests/quiz/web-quiz/class-round-amend.test.js` · `bot/tests/quiz/web-quiz/class-round-endcard.test.js` · `bot/tests/quiz/web-quiz/class-round-golden.test.js` · `bot/tests/quiz/web-quiz/class-round-lines.test.js` · `bot/tests/quiz/web-quiz/class-round-paused-card.test.js` · `bot/tests/quiz/web-quiz/class-round.test.js` (+12: `python3 kg/kg.py who-reads bot/shared/routes/teacher-report-internal.routes.js`)
- `teacher-training-endpoint.js` ← `bot/tests/routes/training-module-unlock-logic.test.js` · `bot/tests/routes/training-unlock-axes.test.js` · `tests/fixtures/delegate-training-to-bot.js` · `tests/training/capstone-reachable.test.js` · `tests/training/certificate-flow-entry.test.js` · `tests/training/exam-caption-served-count.test.js` (+15: `python3 kg/kg.py who-reads bot/shared/routes/teacher-training-endpoint.js`)
- `training-msq-endpoint.js` ← `tests/training/quiz-multi-select-flow.test.js`
- `transcript-quiz-flow-endpoint.js` ← `bot/tests/quiz/lp-quiz-queue-failed.test.js` · `bot/tests/quiz/report-not-through.test.js` · `bot/tests/quiz/transcript-quiz-flow-action-empty.test.js` · `bot/tests/quiz/transcript-quiz-flow-class-labels.test.js` · `bot/tests/quiz/transcript-quiz-flow-endpoint.test.js` · `tests/quiz/lp-quiz-downstream-parity.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/routes/transcript-quiz-flow-endpoint.js`)
- `web-quiz-class-link.routes.js` ← `bot/tests/quiz/web-quiz/web-quiz-class-link.test.js`
- `web-quiz-internal.routes.js` ← `bot/tests/quiz/web-quiz/all-grades-shelves.test.js` · `bot/tests/quiz/web-quiz/challenge-story-readalong.test.js` · `bot/tests/quiz/web-quiz/challenge-story-serve.test.js` · `bot/tests/quiz/web-quiz/class-round-endcard.test.js` · `bot/tests/quiz/web-quiz/practice-play-routes.test.js` · `bot/tests/quiz/web-quiz/teacher-join-queue.test.js` (+60: `python3 kg/kg.py who-reads bot/shared/routes/web-quiz-internal.routes.js`)

## Related (all, generated)
- skills: `registration`?
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/lp-v8/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/observe/CLAUDE.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.md`? · `bot/tests/registration/CLAUDE.md`? · `bot/tests/routes/CLAUDE.md`? · `bot/tests/services/CLAUDE.index.md`? · `bot/tests/services/CLAUDE.md`? · `docs/features/video-quiz.md`? · `docs/quiz-telemetry.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `tests/BASELINE.md`?
