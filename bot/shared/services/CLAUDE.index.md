# services — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 16 files: 0 test + 16 support) |
| `assessment/` | Assessment (exam paper) generator: textbook pages to marked, rendered papers → `assessment/CLAUDE.md` |
| `attendance/` | BigQuery sync of the daily teacher-presence rollup to the STEPS warehouse → `attendance/CLAUDE.md` |
| `authz/` | Capability gate: may this user do X, answered from feature_permissions data → `authz/CLAUDE.md` |
| `cache/` | Railway Redis client: caching, rate limits, webhook dedup, distributed locks → `cache/CLAUDE.md` |
| `child-test/` | Child learning-assessment (EGRA/EGMA): draw, coach chat, scoring, check Flow → `child-test/CLAUDE.md` |
| `classes/` | Classes model: write surface, label parsing, vocabulary and class manager door → `classes/CLAUDE.md` |
| `coaching/` | Coaching pipeline: recording to analysis, reflection, report, video clips, weekly report → `coaching/CLAUDE.md` |
| `exam-checker/` | Exam-paper checker: OCR, grading, annotation and delivery behind one orchestrator → `exam-checker/CLAUDE.md` |
| `fflp/` | Free-form lesson-plan engine seam, default OFF behind app_settings.freeform_lp → `fflp/CLAUDE.md` |
| `first-touch/` | One-door /quiz entry, quiz-maker and teacher-home pages, all switch-gated → `first-touch/CLAUDE.md` |
| `monitoring/` | Lesson-plan health (hourly) and quiz-funnel (2-hourly) watcher alerts to operators → `monitoring/CLAUDE.md` |
| `nudges/` | Scheduled teacher nudges: store, sweeper, caps, coaching ask, quiz offer → `nudges/CLAUDE.md` |
| `observe/` | /observe: coach observations, debrief, report to teacher, scheduling, calendar → `observe/CLAUDE.md` |
| `push/` | Web quiz reminder push: VAPID subscriptions, routes and finish-response field → `push/CLAUDE.md` |
| `queue/` | Queue driver selector: SQS default or BullMQ over Redis, same method surface → `queue/CLAUDE.md` |
| `quiz/` | Class quizzes, video quizzes, storybooks and the child web quiz (Jugnu) services → `quiz/CLAUDE.md` |
| `reading/` | Reading assessment: transcript, pronunciation, fluency, comprehension, PDF report → `reading/CLAUDE.md` |
| `remark/` | Principal's Supervisor Remark (/remark): rubric walk, scores, teacher narrative → `remark/CLAUDE.md` |
| `roster/` | /roster pipeline: decrypt photo, vision-extract rows, edit lines, store photos → `roster/CLAUDE.md` |
| `sa-game/` | The SA battery as a home game: switch, page facts, run sink behind the portal edge → `sa-game/CLAUDE.md` |
| `schools/` | School lookup from the schools table and the legacy-migration transforms → `schools/CLAUDE.md` |
| `settings/` | Shared app_settings switch cache and the page-switch snapshot → `settings/CLAUDE.md` |
| `status/` | Decision for the /status reply before anything is sent → `status/CLAUDE.md` |
| `training/` | Teacher training: modules, quizzes, certificates, I-SAPS exams and grading → `training/CLAUDE.md` |
| `tts/` | Voice gateway for all voice notes: routing, providers, Ogg Opus and text prep → `tts/CLAUDE.md` |
| `video/` | Student video pipeline: script, images, animation, assembly, watermark, queue → `video/CLAUDE.md` |
| `anthropic-native-facade.js` | Direct-Anthropic lane on the official SDK with working prompt caching; used by llm-client.js (bd-oak77.29) |
| `app-journey.js` | Pure journey-id helpers joining WhatsApp command, app link and app page rows in Axiom (bd-4r3rei) |
| `app-login-link.js` | Pure sign/verify of the signed-in /go app login link sent in place of a feature (bd-fmf24g.35) |
| `app-redirect.service.js` | Per-feature app_settings switches that send a teacher to the app instead of serving a feature on WhatsApp |
| `assessment-entry.service.js` | Single door that opens the assessment generator Flow, shared by text handler and menu rows |
| `attendance-entry.service.js` | Single door into attendance: turns the router's decision into WhatsApp messages (openAttendance, respondToDecision) |
| `attendance-portal.service.js` | Class attendance service for the teacher portal sharing marking rules with the WhatsApp Flow (bd-fmf24g.7) |
| `attendance-register-delivery.service.js` | I/O for delivering the monthly teacher attendance register (R2 store, WhatsApp send) to the principal |
| `attendance-register.service.js` | Pure builder of the cumulative monthly teacher-attendance register workbook buffer |
| `attendance-router.service.js` | Pure planner deciding what the word 'attendance' means per role (teacher vs class register, tap vs voice) |
| `attendance-write.service.js` | Single write path for attendance records, shared by the WhatsApp Flow and the portal HTTP route |
| `audio.service.js` | Audio transcription/TTS service: Soniox primary/backup, Uplift and other providers with timeouts and fallbacks |
| `aws-textract.service.js` | Lazy AWS Textract wrapper used as optional OCR fallback for the exam checker (Mistral is primary) |
| `bandit.service.js` | Thompson-sampling multi-armed bandit choosing best message variants for suggestions and A/B tests |
| `coach-school-target.js` | Landing-target resolver for a coach's school-card /go token (school page or My schools) |
| `coach-voice-note-retention.service.js` | Sweeps coach-visit voice notes from R2 30 days after saving unless the coach already closed the visit (bd-v0toag.67) |
| `coaching-orchestrator.service.js` | Coaching orchestrator: facade over the coaching microservices for the classroom observation workflow |
| `content.service.js` | Content generation through the Gamma API (lesson plans and presentations) |
| `context.service.js` | Injects past-feature context into prompts only when the user references past work (opt-in memory) |
| `conversation-resume.service.js` | Offers an interrupted (paused) task back to the teacher using conversation-state storage |
| `conversation-state.service.js` | The one store for 'what is this teacher doing right now' conversation state, replacing four disagreeing stores |
| `curriculum-lp-ast.service.js` | Read-only accessor over the curriculum_lp_ast table of pre-render lesson plan step JSON |
| `e2e-cassette.js` | Record/replay cassette for vendor calls (Soniox, LLM, ElevenLabs) so staging coaching E2E runs are fast |
| `elevenlabs.service.js` | ElevenLabs text-to-speech client with per-language voices and Ogg Opus output rates |
| `feature-intro.service.js` | First-use tracking and intro-video sending for features (implicit/explicit consent points) |
| `feature-keyword-detector.service.js` | Detects feature keywords in user messages and offers the intro video with consent |
| `feature-linker.service.js` | Suggests the next logical feature after one completes (lesson plan, coaching, reading) with weighted odds |
| `feature-registration.service.js` | One-question 'what should I call you' registration triggered after first feature completion |
| `fln-go-target.js` | Landing target resolver for the FLN plan 'Send to teacher' /go token (fln:<plan id>) |
| `fln-index.service.js` | Reads the small FLN corpus index.json sidecar so the bot can name Reading Hour/Numeracy plans |
| `fln-keys.js` | HMAC-derived short keys for FLN send teacher picker and log/event rows, so no user id or phone leaves the server |
| `fln-send.service.js` | FLN 'Send to teacher': a leader sends a plan to teachers via in-window cta_url or the fln_plan_open_v1 template |
| `fln-send.strings.js` | Bilingual copy for FLN 'Send to teacher', matching the approved fln_plan_open_v1 template text |
| `flow-encryption.service.js` | WhatsApp Flow data-api 3.0 payload decryption/encryption (RSA-OAEP AES key, AES-GCM) for Flow endpoints |
| `gpt5-mini.service.js` | GPT-5 mini pedagogical analysis for classroom coaching (FICO marks, LP criteria) with prompt caching |
| `grounded-lp-render.service.js` | Turns a curriculum_lp_ast row into a delivered PDF via Gamma, cache and serve; shared by handler and worker |
| `helper-agent.service.js` | LLM helper agent that detects stuck users and recovers dead-end conversations |
| `homework-lookup.service.js` | Reads homework_chapters to resolve grade x subject x chapters selection into R2 keys for the bundle worker |
| `inbound-typing.js` | Typing indicator for one inbound message, shown only while a message reply is genuinely coming (bd-0wrn4) |
| `language-detector.service.js` | Detects the primary language of user text, trusting Soniox languages and falling back to an LLM |
| `lesson-plan-lifecycle.service.js` | Records a lesson-plan ask's path, stages, outcome and log id in lesson_plan_requests; others write it too |
| `lesson-plan-queue.service.js` | Queues async lesson plan generation to SQS and tracks the request; worker generates with Gamma and sends |
| `lesson-plan-template.service.js` | Single source of truth for the text/Gamma lesson-plan framework, replacing three divergent copies in content.service |
| `lesson-planning.service.js` | Thin wrapper moving a user from the menu into the lesson planning conversation |
| `lesson-plans-web-link.js` | Builds the WhatsApp link opening the portal's lesson plans, gated by web_lessons_enabled/web_lessons_teachers |
| `llm-client.js` | LLM client factory: OpenRouter default, direct OpenAI or Anthropic lanes, one interface for all completions |
| `lp-ab-ch310.service.js` | ICT G1-5 ch3-10 lesson plan A/B: assigns v8 vs v9 render by school from niete_lp_ab_assignment (bd-5o0ay.10.1) |
| `lp-app-open-survey.service.js` | Schedules the 'was this plan useful' survey when a teacher opens a plan in the app viewer (bd-qvevax.2) |
| `lp-browse-entry.service.js` | Single door into the v8 lesson-plan catalogue Flow for every 'I want a lesson plan' path |
| `lp-context.service.js` | Builds the recent-lesson-plan context appended to the conversational AI system prompt (bd-njn7u Phase 2) |
| `lp-delivery-marker.service.js` | Writes a delivery marker row into conversations so lesson hand-overs are visible to the model (bd-wpupy F5) |
| `lp-describe-fln.js` | Describes an FLN Reading Hour/Numeracy plan (name, level, minutes) for lp-describe from the sidecar index |
| `lp-describe.service.js` | Resolves lesson plan keys (k5, g612, fln) to names for the portal activity lists via /api/internal/lp/describe |
| `lp-feedback.service.js` | Post-delivery 'Was this useful?' micro-survey for lesson plans, ported from main bot, English/Urdu only |
| `lp-shelf.service.js` | Redis shelf of a teacher's last 5 delivered lesson plans powering multi-plan Q&A |
| `lp-v10-card.service.js` | Serves the v10 coaching-test card to plan-arm v10 schools, else the v9 lesson (bd-v0toag.50.1) |
| `lp-v8-browse.service.js` | Surface-neutral v8 K-5 lesson catalogue browse (grades, subjects, chapters, lessons, PDF url) for Flow and portal |
| `lp-v8-catalog.service.js` | Loads the static v8 lp_catalog.json and builds NavigationList rows, intersected with servable niete_lp_assets |
| `lp-v8-delivery.service.js` | Delivers one v8 lesson plan on WhatsApp: send, record attempt, emit, then schedule survey on success |
| `lp-v8-lifecycle.service.js` | Records a portal/app grades 1-5 lesson ask into the lesson-plan lifecycle row (source niete_v8_segment) |
| `lp-vision-ocr.service.js` | Vision OCR for scanned or photo lesson plans where pdf-parse finds nothing and Textract fails (bd-o1m1m) |
| `lp-voicenote-script.service.js` | Reads the .txt script stored beside each v8 voicenote on R2 so LP Q&A knows what the teacher heard |
| `lp612-author.service.js` | Authors a 6-12 lp_doc (schema 3.0) from a segment through the v9 revision ladder, ported from the Python pipeline |
| `lp612-browse.service.js` | Surface-neutral browse of the 6-12 lesson-plan corpus (5,466 segments) for WhatsApp and portal |
| `lp612-catalog.service.js` | Builds the 6-12 menu tree grade, subject, chapter, subtopic in the textbook's own order |
| `lp612-deliveries.store.js` | Store for niete_lp612_deliveries: which 6-12 lessons each teacher received, read by /quiz recent list |
| `lp612-edit-intent.service.js` | Classifies a teacher's reply to a 6-12 lesson as an in-scope edit or out-of-scope request for the revision ladder |
| `lp612-edit-router.service.js` | Routes a reply to a received 6-12 lesson into the edit ladder instead of general chat (maybeHandleLp612Reply) |
| `lp612-fbise-tags.js` | Attaches FBISE status tags for each SLO of a Grade 9-12 lesson at render time from a prebuilt map (bd-f01ob) |
| `lp612-feedback-taps.service.js` | Inbound taps for the 6-12 survey: thumbs, 'did you teach it', and the thumbs-down reason window (bd-86ivw) |
| `lp612-feedback.service.js` | Outbound half of the 6-12 post-delivery 'did that lesson help' survey (bd-86ivw) |
| `lp612-feedback.shared.js` | Shared ids, windows and lookups for the 6-12 survey's outbound and inbound halves (bd-86ivw, bd-2dpco) |
| `lp612-latin-honorific.js` | Normalises Latin PBUH/SAW honorifics to the house stamp so they pass religious gate G5c (bd-b7txa) |
| `lp612-lifecycle.service.js` | Writes the lesson-plan lifecycle row for a Grades 6-12 ask across WhatsApp and portal outcomes |
| `lp612-overlay-backfill.service.js` | Backfill driver walking niete_lp612_renders to top up and re-render cached Urdu lessons in R2 (bd-idneu) |
| `lp612-overlay-repair.service.js` | Repairs one cached Urdu 6-12 render back onto its own R2 objects and row (repairRow, bd-0t9ce) |
| `lp612-overlay-topup.service.js` | Tops up one cached Urdu overlay in memory after overlayTargets widened to titles and headers (bd-idneu) |
| `lp612-pagetruth.service.js` | Page-truth retrieval: hands the 6-12 author the exact textbook pages it asked for or fails by name |
| `lp612-render-policy.service.js` | Single policy for which render defects may still reach a teacher (final render, timeout recovery, Urdu overlay) |
| `lp612-render.service.js` | Renders a 6-12 lp_doc to self-contained HTML and A4 PDF via the vendored lp-v9 renderer |
| `lp612-serving.service.js` | 6-12 serving: finds or authors a render for (segment, lang, template version) with R2 cache and waiters |
| `menu-match.service.js` | Reads a message no door caught against the user's live menu so the fallthrough classifier can open the right feature |
| `menu.service.js` | Menu service: builds and sends the role-shaped WhatsApp menu rows and handles refused taps |
| `mms-inference.service.js` | HTTP client for the MMS-ASR microservice (Balochi, Sindhi, Pashto speech recognition) |
| `name-extractor.service.js` | GPT-4o-mini extraction of student names and attendance status from transcripts |
| `openai.service.js` | OpenAI/OpenRouter chat service for text replies; sets the shared brief-reply shape and strips markdown (bd-gr4fy.5.10) |
| `outbound-echo.js` | Logs outbound WhatsApp payloads for synthetic test phones only so E2E simulators can see what to tap |
| `oxbridge-lp.service.js` | Oxbridge lesson-plan picker for grade 6-12 asks: matches lesson_plan_catalog rows, offers Oxbridge vs Rumi LP (FEAT-080) |
| `pdf-report.service.js` | PDFKit generator of classroom observation report PDFs with no system dependencies |
| `phoneless-inbound.js` | Handles inbound messages with no phone number (username-only senders) with a switch-gated reply |
| `portal-invite.service.js` | Generates portal setup tokens with 7-day expiry and sends the teacher portal invitation on WhatsApp |
| `portal-link-token.js` | Pure sign/verify of the 24h portal link tokens that log one teacher into one portal area from a template button |
| `portal-ready-templates.js` | Pure builder of template parameters for the lesson_plan_ready_v1 and paper_ready_v1 UTILITY templates (bd-fmf24g.15) |
| `portal-ready-whatsapp.service.js` | Sweep sending the WhatsApp fallback template for a finished paper or 6-12 plan a teacher missed (bd-fmf24g.15) |
| `portal-request.js` | Decides whether a message is a bare portal request (word or slash) so the /portal door opens |
| `portal-web-link.js` | Generic per-area 'open on the web' link sender gated by app_settings enabled flag and teacher allow-list |
| `pregen-lookup.service.js` | Checks whether a pre-generated lesson plan exists for a chapter |
| `reaction-only-taps.js` | Lists tap ids answered only by a free reaction and settles the typing scope at the webhook door (bd-w2daa.31) |
| `reading-assessment.service.js` | Reading assessment service managing EGRA/ASER-style reading fluency assessments |
| `redis-comprehension.service.js` | Comprehension flow state stored in the database (not Redis) for active question flows |
| `region-features.service.js` | DB-driven region gating from the region_features table, replacing hardcoded region checks |
| `registration-invite.service.js` | The one registration Flow invite sender used by every door that offers the form |
| `roster-entry.service.js` | Single door opening the class-roster builder Flow, applying the leader gate |
| `session.service.js` | Message dedup and user tracking with Redis persistence and in-memory fallback |
| `settings-group.js` | Shared app_settings reader: one query for a host switch and the rider switches that join its group |
| `share-send.service.js` | 'Send on WhatsApp' from portal screens: template-only sendShare behind /api/internal/share/send (bd-fmf24g.30) |
| `soniox-cleanup.service.js` | Deletes old Soniox files and job records on the stale-session tick to avoid account quota fill (FEAT-106) |
| `speaker-roles.js` | Assigns Teacher/Student or Coach/Teacher speaker labels to diarized recordings by recording kind (bd-ri5o9.2) |
| `student-ingress-cache.js` | 10-minute Redis cache of the student-ingress 'who holds this handset' verdict, with forget() |
| `student-ingress-identity.js` | Leaf helpers reading identity and teacher-activity signs from a users row for student-ingress decisions |
| `student-ingress.js` | Student ingress door: decides once per inbound whether a handset is a teacher, child or unknown |
| `student-list.service.js` | CRUD for student lists and individual students |
| `student-mode.service.js` | Decides if a handset is a teacher or one of their pupils and handles pupil free chat as the teaching assistant |
| `student-video-feedback.service.js` | Post-delivery survey lifecycle for the student video library, mirroring lp-feedback.service (bd-1598) |
| `student-videos-entry.service.js` | Single door opening the student video library Flow; returns false silently if STUDENT_VIDEOS_FLOW_ID is unset |
| `teacher-audience.js` | Teacher-audience switch value: the string 'teachers' means every user with role teacher (bd-fmf24g.46) |
| `teacher-state.service.js` | Probes whether a teacher is busy across features and lists cancellable resources for the /status flow |
| `toc-loading.service.js` | Loads curated table-of-contents JSON into the textbook_toc table |
| `topic-matching.service.js` | Matches a teacher's topic request to a textbook chapter by keyword contains then bidirectional substring |
| `urdu-tts-normalizer.js` | Urdu Sara TTS runtime clean-up: spells digits as words to avoid 'alaran' gibberish (FEAT-106 #4b, bd-2375) |
| `vision.service.js` | GPT-4.1 mini multimodal image analysis for images teachers send on WhatsApp |
| `voice-attendance.service.js` | Voice roll call: turns a principal's spoken absentees into a pre-ticked selection, never writing a register directly |
| `webhook-signature.js` | Verifies Meta's X-Hub-Signature-256 HMAC on inbound webhooks and Flow endpoint requests |
| `whatsapp-send-pacer.js` | Per-recipient WhatsApp send pacing shared across processes plus bounded retry for Meta 131056 rate-limit errors |
| `whatsapp-sent-ids.js` | Collects WhatsApp message ids accepted during a block of sends so report delivery can match later statuses |
| `whatsapp-status-pricing.js` | Logs a whatsapp.status.priced event per delivered or read status, keyed by users.id for per-teacher cost (bd-v0toag.65) |
| `whatsapp.service.js` | WhatsApp Cloud API client: all sends (text, buttons, lists, docs, templates, carousels) with code-point caps |
| `whisper-chunk-planner.js` | Plans Whisper chunk splits under the 25MB upload cap for the last-resort transcription fallback (FEAT-106 #1) |

## Who reads this (all, generated)
- `anthropic-native-facade.js` ← imported by `bot/shared/services/llm-client.js:36:e526dad9`
- `app-journey.js` ← imported by `dashboard/routes/app-funnel.routes.js:28:37e01298` · `bot/shared/services/app-login-link.js:28:fd343b89` · `bot/shared/services/app-redirect.service.js:88:67227909`
- `app-login-link.js` ← imported by `bot/shared/handlers/flow-response.handler.js:632:3bc2979c` · `bot/shared/handlers/portal-command.handler.js:18:3bc2979c` · `dashboard/routes/app-login.routes.js:19:e76d249c` · `bot/shared/services/app-redirect.service.js:84:7886d7d9` (+4: `python3 kg/kg.py who-reads app-login-link.js`)
- `app-redirect.service.js` ← imported by `bot/shared/handlers/image-message.handler.js:28:3ba5ce5f` · `bot/shared/handlers/text-message.handler.js:233:1cbd4c53` · `bot/shared/handlers/voice-message.handler.js:44:3ba5ce5f` · `bot/whatsapp-bot.js:372:a39e1540` (+9: `python3 kg/kg.py who-reads app-redirect.service.js`)
- `assessment-entry.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1440:1e0f47b4` · `bot/shared/services/menu.service.js:341:bad9701d`
- `attendance-entry.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:2540:76808684` · `bot/shared/services/menu.service.js:305:468756cd`
- `attendance-portal.service.js` ← imported by `bot/shared/routes/internal-attendance.routes.js:31:3d954556`
- `attendance-register-delivery.service.js` ← imported by `bot/shared/routes/attendance-marking-endpoint.js:43:1e56a351` · `bot/shared/services/attendance-portal.service.js:233:2be74a81`
- `attendance-register.service.js` ← imported by `bot/shared/services/attendance-portal.service.js:234:2daf067f` · `bot/shared/services/attendance-register-delivery.service.js:21:77f5610e`
- `attendance-router.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:59:4ce546e7` · `bot/whatsapp-bot.js:241:8e987bdd` · `bot/shared/services/attendance-entry.service.js:34:d7d94258`
- `attendance-write.service.js` ← imported by `bot/shared/routes/attendance-marking-endpoint.js:39:d809cab7` · `bot/shared/services/attendance-portal.service.js:232:a3404b7b` · `bot/shared/services/attendance-register-delivery.service.js:22:c8fb07f4`
- `audio.service.js` ← imported by `bot/shared/handlers/voice-message.handler.js:10:5930b957` · `bot/whatsapp-bot.js:2544:37ebc6ce` · `bot/shared/services/child-test/scoring/stt.js:15:15df7ce8` · `bot/shared/services/coaching/fidelity/section-b-backfill.service.js:108:15df7ce8` (+9: `python3 kg/kg.py who-reads audio.service.js`)
- `aws-textract.service.js` ← imported by `bot/workers/lesson-plan-extraction.worker.js:12:56d91229`
- `coach-school-target.js` ← imported by `dashboard/routes/app-login.routes.js:180:6122db69` · `bot/shared/services/app-login-link.js:87:8073ef41` · `bot/shared/services/app-redirect.service.js:176:bd821bbb` · `bot/shared/services/schools/school-card-door.js:24:b36819a3`
- `coach-voice-note-retention.service.js` ← imported by `bot/workers/sqs-worker.js:1852:f8d51159`
- `coaching-orchestrator.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:16:73c527bb` · `bot/shared/handlers/voice-message.handler.js:14:73c527bb` · `bot/whatsapp-bot.js:23:eeb29561` · `bot/workers/sqs-worker.js:38:96db3cf9` (+2: `python3 kg/kg.py who-reads coaching-orchestrator.service.js`)
- `content.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:9:056d2128` · `bot/shared/handlers/voice-message.handler.js:12:056d2128` · `bot/workers/lesson-plan-generation.worker.js:15:5c4b2dec` · `bot/shared/services/grounded-lp-render.service.js:26:8099762c`
- `context.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:12:4abb92f2`
- `conversation-resume.service.js` ← imported by `bot/whatsapp-bot.js:770:adbc7a8c` · `bot/workers/sqs-worker.js:2102:45970460` · `bot/shared/services/teacher-state.service.js:24:7f79f69f`
- `conversation-state.service.js` ← imported by `bot/shared/handlers/flow-response.handler.js:50:10ab1f64` · `bot/shared/handlers/text-message.handler.js:19:10ab1f64` · `bot/shared/handlers/voice-message.handler.js:15:10ab1f64` · `bot/shared/routes/attendance-marking-endpoint.js:41:10ab1f64` (+10: `python3 kg/kg.py who-reads conversation-state.service.js`)
- `curriculum-lp-ast.service.js` ← imported by `bot/shared/handlers/lesson-plan-v2.handler.js:28:d8d77c9b` · `bot/workers/lesson-plan-generation.worker.js:20:19e3c52a` · `bot/shared/services/grounded-lp-render.service.js:27:e50f22ed`
- `e2e-cassette.js` ← imported by `bot/shared/services/audio.service.js:705:33e33272` · `bot/shared/services/coaching/reflective-questions/llm-router.service.js:82:9787844f` · `bot/shared/services/elevenlabs.service.js:102:33e33272` · `bot/shared/services/llm-client.js:884:33e33272` (+1: `python3 kg/kg.py who-reads e2e-cassette.js`)
- `elevenlabs.service.js` ← imported by `bot/shared/services/audio.service.js:920:b4cae654` · `bot/shared/services/tts/providers/elevenlabs.provider.js:27:d9b47a9f` · `bot/shared/services/tts/providers/openai.provider.js:14:d9b47a9f`
- `feature-intro.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:30:a2c580e4` · `bot/shared/services/feature-keyword-detector.service.js:16:cdad3fb7` · `bot/shared/services/feature-linker.service.js:20:cdad3fb7` · `bot/shared/services/first-touch/door.keys.js:25:ab6dc515` (+5: `python3 kg/kg.py who-reads feature-intro.service.js`)
- `feature-keyword-detector.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:2722:18efb081` · `bot/whatsapp-bot.js:1255:0e4847c5`
- `feature-linker.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:29:e1a3c9dc` · `bot/whatsapp-bot.js:1240:a7e67306` · `bot/workers/lesson-plan-generation.worker.js:18:9cffe26b` · `bot/shared/services/coaching/report-generator.service.js:29:a1aeaf86` (+1: `python3 kg/kg.py who-reads feature-linker.service.js`)
- `feature-registration.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:11:4ac5f445` · `bot/shared/handlers/voice-message.handler.js:13:4ac5f445` · `bot/workers/lesson-plan-generation.worker.js:19:bca137f5` · `bot/workers/video-generation.worker.js:23:bca137f5` (+2: `python3 kg/kg.py who-reads feature-registration.service.js`)
- `fln-go-target.js` ← imported by `dashboard/routes/app-login.routes.js:188:98eb7896` · `bot/shared/services/app-login-link.js:86:a5c5865b`
- `fln-index.service.js` ← imported by `bot/shared/services/lp-describe-fln.js:86:db3ad3d8`
- `fln-keys.js` ← imported by `bot/shared/routes/internal-fln-send.routes.js:27:e18774a9` · `dashboard/routes/portal-fln-send.routes.js:28:059e0c71` · `bot/shared/services/fln-send.service.js:22:1ef9db28`
- `fln-send.service.js` ← imported by `bot/shared/routes/internal-fln-send.routes.js:53:aba2f7b8`
- `fln-send.strings.js` ← imported by `bot/shared/services/fln-send.service.js:21:89e30e13`
- `flow-encryption.service.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:25:59b33e9c` · `bot/shared/routes/exam-confirm-endpoint.js:22:59b33e9c` · `bot/shared/routes/flow-endpoint.routes.js:15:59b33e9c`
- `gpt5-mini.service.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:17:139682f2` · `bot/shared/services/coaching/coaching-card/commitment-card.service.js:19:742a30d9` · `bot/shared/services/coaching/portal-class-check.js:87:00d7566c` · `bot/shared/services/coaching/reflective-conversation.service.js:18:139682f2` (+8: `python3 kg/kg.py who-reads gpt5-mini.service.js`)
- `grounded-lp-render.service.js` ← imported by `bot/workers/lesson-plan-generation.worker.js:21:3ff30fe0`
- `helper-agent.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:25:ecc0c851`
- `homework-lookup.service.js` ← imported by `bot/shared/routes/homework-request-endpoint.js:22:19bf3392`
- `inbound-typing.js` ← imported by `bot/shared/handlers/text-message.handler.js:33:b4760a90` · `bot/whatsapp-bot.js:11:2545a79b` · `bot/shared/services/app-redirect.service.js:83:5640278f` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:138:084c17b5` (+8: `python3 kg/kg.py who-reads inbound-typing.js`)
- `language-detector.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:10:58e3d002` · `bot/shared/handlers/voice-message.handler.js:1030:58e3d002` · `bot/shared/services/audio.service.js:269:d428b494`
- `lesson-plan-lifecycle.service.js` ← imported by `bot/shared/database/bot-helpers.js:441:e9f9e707` · `bot/shared/handlers/lesson-plan-v2.handler.js:36:b2eb0530` · `bot/shared/routes/homework-request-endpoint.js:23:b2eb0530` · `bot/shared/routes/pakistan-lp-endpoint.js:803:f66c13d3` (+10: `python3 kg/kg.py who-reads lesson-plan-lifecycle.service.js`)
- `lesson-plan-queue.service.js` ← imported by `bot/shared/handlers/lesson-plan-v2.handler.js:29:5ecc6bb0` · `bot/shared/handlers/text-message.handler.js:31:5ecc6bb0` · `bot/shared/handlers/voice-message.handler.js:18:5ecc6bb0` · `bot/shared/routes/internal-api.routes.js:60:5ecc6bb0` (+2: `python3 kg/kg.py who-reads lesson-plan-queue.service.js`)
- `lesson-plan-template.service.js` ← imported by `bot/shared/services/content.service.js:5:16d8038c`
- `lesson-planning.service.js` ← imported by `bot/shared/services/menu.service.js:10:d3ba9a89`
- `lesson-plans-web-link.js` ← imported by `bot/shared/services/lp-browse-entry.service.js:59:7166726d`
- `llm-client.js` ← imported by `bot/shared/handlers/text-message.handler.js:63:7dd19154` · `bot/shared/utils/word-grid-generator.js:22:7dd19154` · `bot/workers/lesson-plan-extraction.worker.js:6:3b73f0a2` · `dashboard/routes/hcp.routes.js:893:4243a38a` (+35: `python3 kg/kg.py who-reads llm-client.js`)
- `lp-ab-ch310.service.js` ← imported by `bot/shared/services/lp-v8-browse.service.js:129:03030987` · `bot/shared/services/lp-v8-delivery.service.js:26:03030987` · `bot/shared/services/quiz/lp-app-opens.store.js:53:a7d6d323`
- `lp-app-open-survey.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1422:1cf81e98`
- `lp-browse-entry.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:49:1f8c74df` · `bot/shared/handlers/voice-message.handler.js:40:fcd207bc` · `bot/workers/lesson-plan-generation.worker.js:26:882d6fc7` · `bot/shared/services/first-touch/maker.fallback.js:61:25dfa8e0` (+1: `python3 kg/kg.py who-reads lp-browse-entry.service.js`)
- `lp-context.service.js` ← imported by `bot/shared/calls/call-context.repo.js:82:ac2a5137` · `bot/shared/handlers/text-message.handler.js:13:11a033c2` · `bot/shared/handlers/voice-message.handler.js:6:11a033c2`
- `lp-delivery-marker.service.js` ← imported by `bot/shared/services/lp-v8-delivery.service.js:25:f19cde34`
- `lp-describe-fln.js` ← imported by `bot/shared/services/lp-describe.service.js:106:8615c728`
- `lp-describe.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1388:fda5e1c1`
- `lp-feedback.service.js` ← imported by `bot/shared/handlers/lesson-plan-v2.handler.js:30:3284ce37` · `bot/shared/handlers/text-message.handler.js:32:3284ce37` · `bot/whatsapp-bot.js:871:cc5f2ea1` · `bot/workers/homework-bundle.worker.js:210:3cf8c555` (+3: `python3 kg/kg.py who-reads lp-feedback.service.js`)
- `lp-shelf.service.js` ← imported by `bot/shared/services/attendance-router.service.js:336:27fa99fb` · `bot/shared/services/coaching/coaching-session.service.js:37:782730e3` · `bot/shared/services/lp-context.service.js:45:27fa99fb` · `bot/shared/services/lp-v8-delivery.service.js:21:27fa99fb` (+5: `python3 kg/kg.py who-reads lp-shelf.service.js`)
- `lp-v10-card.service.js` ← imported by `bot/shared/services/lp-v8-browse.service.js:173:f38c1148` · `bot/shared/services/lp-v8-delivery.service.js:29:f38c1148`
- `lp-v8-browse.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1254:e37617b4` · `bot/shared/services/share-send.service.js:88:ddbe5c42`
- `lp-v8-catalog.service.js` ← imported by `bot/shared/calls/call-tools.repo.js:133:3feaf5e3` · `bot/shared/routes/pakistan-lp-endpoint.js:51:3feaf5e3` · `bot/shared/services/coaching/lp-coaching/recent-fidelity-lps.service.js:41:1f46c9ff` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:59:11173c56` (+14: `python3 kg/kg.py who-reads lp-v8-catalog.service.js`)
- `lp-v8-delivery.service.js` ← imported by `bot/shared/routes/pakistan-lp-endpoint.js:52:7d11cb01` · `bot/shared/services/lp-app-open-survey.service.js:150:4ef7ad19` · `bot/shared/services/lp-v8-browse.service.js:49:8f3e780a`
- `lp-v8-lifecycle.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1342:ba6311e7` · `bot/shared/services/lp-app-open-survey.service.js:164:850b9634`
- `lp-vision-ocr.service.js` ← imported by `bot/workers/lesson-plan-extraction.worker.js:316:64ef8abe`
- `lp-voicenote-script.service.js` ← imported by `bot/shared/calls/call-tools.repo.js:166:48bb8c99` · `bot/shared/services/lp-context.service.js:47:d25986e6`
- `lp612-author.service.js` ← imported by `bot/workers/lp612-author.worker.js:37:6e456921` · `bot/shared/services/lp612-overlay-topup.service.js:48:e73cab30`
- `lp612-browse.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:2132:0eea3dc6`
- `lp612-catalog.service.js` ← imported by `bot/shared/routes/pakistan-lp-endpoint.js:53:22b61272` · `bot/shared/services/lp612-serving.service.js:42:6a71a39f`
- `lp612-deliveries.store.js` ← imported by `bot/workers/lp612-author.worker.js:55:3082da04` · `bot/shared/services/lp612-browse.service.js:47:e2c4a7ac` · `bot/shared/services/lp612-serving.service.js:869:e2c4a7ac` · `bot/shared/services/portal-ready-whatsapp.service.js:44:e2c4a7ac` (+1: `python3 kg/kg.py who-reads lp612-deliveries.store.js`)
- `lp612-edit-intent.service.js` ← imported by `bot/shared/services/lp612-edit-router.service.js:32:e914c6c9`
- `lp612-edit-router.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:52:bdc1c464`
- `lp612-fbise-tags.js` ← imported by `bot/shared/services/lp612-render.service.js:45:687c87a1`
- `lp612-feedback-taps.service.js` ← imported by `bot/shared/services/lp612-feedback.service.js:56:d4c10cb1`
- `lp612-feedback.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:351:f215d166` · `bot/whatsapp-bot.js:883:c634cdc4` · `bot/shared/services/lp-app-open-survey.service.js:194:83b4d372` · `bot/shared/services/lp612-serving.service.js:897:83b4d372`
- `lp612-feedback.shared.js` ← imported by `bot/shared/services/lp612-feedback-taps.service.js:18:59304a35` · `bot/shared/services/lp612-feedback.service.js:53:59304a35`
- `lp612-latin-honorific.js` ← imported by `bot/shared/services/lp612-author.service.js:58:7ec38464`
- `lp612-lifecycle.service.js` ← imported by `bot/workers/lp612-author.worker.js:53:bde1dd20` · `bot/shared/services/lp612-serving.service.js:43:a8df427c`
- `lp612-overlay-backfill.service.js` ← imported by `bot/scripts/lp612-overlay-backfill.js:35:08b31d88`
- `lp612-overlay-repair.service.js` ← imported by `bot/shared/services/lp612-overlay-backfill.service.js:43:32b41bda`
- `lp612-overlay-topup.service.js` ← imported by `bot/shared/services/lp612-overlay-backfill.service.js:42:48f1fe6f` · `bot/shared/services/lp612-overlay-repair.service.js:43:d97d8e6d`
- `lp612-pagetruth.service.js` ← imported by `bot/workers/lp612-author.worker.js:51:7d55c82f` · `bot/shared/services/lp612-author.service.js:50:81b1bba6` · `bot/shared/services/lp612-overlay-repair.service.js:44:a64bf527`
- `lp612-render-policy.service.js` ← imported by `bot/workers/lp612-author.worker.js:42:e131a457` · `bot/shared/services/lp612-author.service.js:40:b9e75058` · `bot/shared/services/lp612-overlay-repair.service.js:42:7aa43d77`
- `lp612-render.service.js` ← imported by `bot/workers/lp612-author.worker.js:43:0dc19ead` · `bot/shared/services/lp612-overlay-repair.service.js:41:5c340dcb`
- `lp612-serving.service.js` ← imported by `bot/scripts/lp612-sidecar-audit.js:30:38e05100` · `bot/shared/routes/internal-api.routes.js:2224:80eb21d7` · `bot/shared/routes/pakistan-lp-endpoint.js:54:9efae5ef` · `bot/workers/lp612-author.worker.js:52:38e05100` (+4: `python3 kg/kg.py who-reads lp612-serving.service.js`)
- `menu-match.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:21:69e67cb7` · `bot/shared/handlers/voice-message.handler.js:1309:69e67cb7`
- `menu.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:20:fea99352` · `bot/shared/handlers/voice-message.handler.js:16:fea99352` · `bot/whatsapp-bot.js:1554:6d596f17` · `bot/shared/services/child-test/conversation/machine.js:1659:3178da40` (+3: `python3 kg/kg.py who-reads menu.service.js`)
- `mms-inference.service.js` ← imported by `bot/shared/services/audio.service.js:1256:0934c6da`
- `openai.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:8:c5599cb0` · `bot/shared/handlers/voice-message.handler.js:5:c5599cb0` · `bot/whatsapp-bot.js:22:eaa7b0f5` · `bot/shared/services/video/video-orchestrator.service.js:12:ef319d24` (+1: `python3 kg/kg.py who-reads openai.service.js`)
- `outbound-echo.js` ← imported by `bot/shared/services/whatsapp.service.js:91:5b56d093`
- `oxbridge-lp.service.js` ← imported by `bot/shared/handlers/lesson-plan-v2.handler.js:31:229efb42` · `bot/shared/routes/pakistan-lp-endpoint.js:49:229efb42` · `bot/whatsapp-bot.js:912:952a6e2d`
- `pdf-report.service.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:28:d0116dd0` · `bot/shared/services/coaching/report-renderers/renderer-registry.js:94:8152b12c`
- `phoneless-inbound.js` ← imported by `bot/shared/handlers/text-message.handler.js:544:ffaf3041` · `bot/whatsapp-bot.js:663:127fb763`
- `portal-invite.service.js` ← imported by `bot/whatsapp-bot.js:24:0517431a` · `scripts/create-analytics-user.js:369:0439c6ca`
- `portal-link-token.js` ← imported by `dashboard/routes/iab-probe.routes.js:24:d70d7b6f` · `dashboard/routes/portal-link.routes.js:28:d70d7b6f` · `bot/shared/services/portal-ready-whatsapp.service.js:43:8ce3f3b2` · `bot/shared/services/portal-web-link.js:30:8ce3f3b2`
- `portal-ready-templates.js` ← imported by `bot/shared/services/portal-ready-whatsapp.service.js:46:25333a99`
- `portal-ready-whatsapp.service.js` ← imported by `bot/workers/sqs-worker.js:2082:00dfe717`
- `portal-request.js` ← imported by `bot/shared/handlers/text-message.handler.js:27:31641614` · `bot/shared/services/student-ingress.js:54:f15788b2`
- `portal-web-link.js` ← imported by `bot/shared/services/lesson-plans-web-link.js:12:1591a293` · `bot/shared/services/portal-ready-templates.js:17:285fd07e` · `bot/shared/services/portal-ready-whatsapp.service.js:47:ced84025` · `bot/shared/services/training/training-web-link.js:12:829b3dd4`
- `pregen-lookup.service.js` ← imported by `bot/shared/handlers/lesson-plan-v2.handler.js:27:84436122`
- `reaction-only-taps.js` ← imported by `bot/whatsapp-bot.js:699:3e9a4b98`
- `reading-assessment.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:28:d507b8b8` · `bot/shared/handlers/voice-message.handler.js:649:d507b8b8` · `bot/whatsapp-bot.js:25:dcc1f3ca`
- `redis-comprehension.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1702:d7e6f29b` · `bot/shared/handlers/voice-message.handler.js:289:d7e6f29b` · `bot/whatsapp-bot.js:1130:081b24ae` · `bot/shared/services/reading/analysis.service.js:1223:aca19c51`
- `region-features.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:35:f7f1b1e6`
- `registration-invite.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:47:ade62736` · `bot/shared/services/feature-registration.service.js:24:763ca180`
- `roster-entry.service.js` ← imported by `bot/shared/services/menu.service.js:362:eee93c89`
- `session.service.js` ← imported by `bot/whatsapp-bot.js:21:7247c8f3`
- `settings-group.js` ← imported by `bot/shared/services/quiz/reminder-live-preview-flag.js:12:46648006` · `bot/shared/services/quiz/report-fold-flag.js:13:46648006` · `bot/shared/services/quiz/report-send-check.js:29:46648006`
- `share-send.service.js` ← imported by `bot/shared/routes/internal-share.routes.js:20:83adb6c5` · `bot/shared/services/coaching/report-window-send.js:22:55fb21f8`
- `soniox-cleanup.service.js` ← imported by `bot/workers/sqs-worker.js:43:9ab11df9` · `bot/workers/stale-session.worker.js:29:9ab11df9`
- `speaker-roles.js` ← imported by `bot/shared/services/audio.service.js:1040:ec33d74c` · `bot/shared/services/coaching/diarization-from-tokens.js:188:3ac10b56` · `bot/shared/services/observe/observe-debrief.service.js:1126:e6ddab8e`
- `student-ingress-cache.js` ← imported by `bot/shared/handlers/flow-response.handler.js:576:85d00890` · `bot/shared/services/feature-registration.service.js:303:53dafd0e` · `bot/shared/services/quiz/student-identity.service.js:31:f57de5ef` · `bot/shared/services/student-ingress.js:57:65786137`
- `student-ingress-identity.js` ← imported by `bot/shared/services/first-touch/role.service.js:192:9ae4fd22` · `bot/shared/services/quiz/web-quiz-student-join.js:281:35981347` · `bot/shared/services/student-ingress.js:62:c9c14994`
- `student-ingress.js` ← imported by `bot/whatsapp-bot.js:718:f618e183` · `bot/shared/services/quiz/web-quiz-bind.service.js:416:e69d4bfb` · `bot/shared/services/quiz/web-quiz-sample-ping.js:184:0f250d66` · `bot/shared/services/quiz/web-quiz-student-join.js:262:0f250d66`
- `student-list.service.js` ← imported by `bot/shared/routes/flow-endpoint.routes.js:16:98592a4c` · `bot/shared/services/classes/class.service.js:1118:6386fcb5`
- `student-mode.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:62:b46e21b0` · `bot/shared/services/first-touch/role.service.js:107:3811ab7d` · `bot/shared/services/quiz/child-phone-bindings.repo.js:215:3811ab7d` · `bot/shared/services/quiz/teacher-self-test.js:21:d770fefc` (+1: `python3 kg/kg.py who-reads student-mode.service.js`)
- `student-video-feedback.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:835:e0e119d1` · `bot/shared/routes/student-videos-endpoint.js:24:e0e119d1` · `bot/whatsapp-bot.js:1364:0f5046fc` · `bot/shared/services/quiz/video-quiz.service.js:344:5cfea78e`
- `student-videos-entry.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1572:bbd1f59c` · `bot/shared/services/first-touch/maker.fallback.js:54:28a048e1` · `bot/shared/services/menu.service.js:347:7ed9c54b`
- `teacher-audience.js` ← imported by `dashboard/lib/feature-flags.js:20:9b983ff1` · `dashboard/routes/portal-fln-links.routes.js:21:9ba34ce7` · `bot/shared/services/app-redirect.service.js:86:3173f550`
- `teacher-state.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:2385:0df0a522` · `bot/shared/routes/status-flow-endpoint.js:18:0df0a522`
- `topic-matching.service.js` ← imported by `bot/shared/handlers/lesson-plan-v2.handler.js:26:eb311e53`
- `urdu-tts-normalizer.js` ← imported by `bot/shared/services/elevenlabs.service.js:12:f0d2f0da` · `bot/shared/services/tts/text/normalizers.js:11:66d7ccd2`
- `vision.service.js` ← imported by `bot/shared/handlers/image-message.handler.js:21:b1ec372a` · `bot/shared/services/coaching/classroom-photo/photo-analysis.service.js:68:2eae021b`
- `voice-attendance.service.js` ← imported by `bot/shared/handlers/voice-message.handler.js:195:c0bd7698` · `bot/shared/routes/attendance-marking-endpoint.js:40:c0bd7698` · `bot/whatsapp-bot.js:267:70727e95` · `bot/shared/services/attendance-entry.service.js:35:93821dfa`
- `webhook-signature.js` ← imported by `bot/whatsapp-bot.js:75:6186fb81`
- `whatsapp-send-pacer.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:231:559aed18` · `bot/shared/routes/observe-mewaka-endpoint.js:112:559aed18` · `bot/shared/routes/pakistan-lp-endpoint.js:48:559aed18` · `bot/shared/routes/student-videos-endpoint.js:26:559aed18` (+2: `python3 kg/kg.py who-reads whatsapp-send-pacer.js`)
- `whatsapp-sent-ids.js` ← imported by `bot/workers/quiz-job-handler.js:171:00b42930` · `bot/shared/services/quiz/video-quiz-report.service.js:49:6e4da814` · `bot/shared/services/whatsapp.service.js:254:7726bc50`
- `whatsapp-status-pricing.js` ← imported by `bot/whatsapp-bot.js:59:b880f62b`
- `whatsapp.service.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:11:1bba4f75` · `bot/shared/handlers/flow-response.handler.js:53:1bba4f75` · `bot/shared/handlers/image-message.handler.js:20:1bba4f75` · `bot/shared/handlers/lesson-plan-v2.handler.js:34:1bba4f75` (+160: `python3 kg/kg.py who-reads whatsapp.service.js`)
- `whisper-chunk-planner.js` ← imported by `bot/shared/services/audio.service.js:21:a993baaf`
- column `attendance_sessions.absent_count` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:910:1d8f45d1` · `bot/shared/services/attendance-portal.service.js:294:1005c9e6`
- column `attendance_sessions.leave_count` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:910:1d8f45d1` · `bot/shared/services/attendance-portal.service.js:294:1005c9e6`
- column `attendance_sessions.list_id` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:911:d6a88d45` · `bot/shared/services/attendance-portal.service.js:294:1005c9e6` · `bot/shared/services/attendance-register-delivery.service.js:81:83bce7c1`
- column `attendance_sessions.present_count` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:910:1d8f45d1` · `bot/shared/services/attendance-portal.service.js:294:1005c9e6`
- column `attendance_sessions.session_date` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:912:c60302f6` · `bot/shared/services/attendance-portal.service.js:296:608de445` · `bot/shared/services/attendance-register-delivery.service.js:80:127e29e3`
- column `attendance_sessions.session_type` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:913:ed3685ce` · `bot/shared/services/attendance-portal.service.js:297:2ec35670`
- column `attendance_sessions.user_id` (written by `attendance-write.service.js`) ← read by `dashboard/services/teacher-home-order.service.js:232:57e1664c`
- column `coach_visit_requests.updated_at` (written by `coach-voice-note-retention.service.js`) ← read by `dashboard/services/coach-disagreements.service.js:258:a1c017d3`
- column `coach_visit_requests.voice_note_key` (written by `coach-voice-note-retention.service.js`) ← read by `dashboard/services/coach-disagreements.service.js:256:f9788955` · `dashboard/services/coach-visit-request.js:192:687f8c28`
- column `coaching_sessions.analysis_data` (written by `coaching-orchestrator.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` · `bot/shared/routes/observe2-check-endpoint.js:297:ed6f6cd9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+33: `python3 kg/kg.py who-reads coaching_sessions.analysis_data`)
- column `coaching_sessions.conversation_state` (written by `coaching-orchestrator.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/workers/stale-session.worker.js:141:134f4724` · `dashboard/routes/portal.routes.js:7775:e2da0b61` · `bot/scripts/generate-coaching-excel.js:38:950960b9` (+9: `python3 kg/kg.py who-reads coaching_sessions.conversation_state`)
- column `coaching_sessions.status` (written by `coaching-orchestrator.service.js`, `teacher-state.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1923:21a55915` · `bot/shared/handlers/voice-message.handler.js:744:21a55915` (+40: `python3 kg/kg.py who-reads coaching_sessions.status`)
- column `coaching_sessions.updated_at` (written by `coaching-orchestrator.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/workers/stale-session.worker.js:1243:f827ae3c` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:193:6d171412` · `bot/shared/services/coaching/portal-class-check.js:181:5720b09e` (+3: `python3 kg/kg.py who-reads coaching_sessions.updated_at`)
- column `lesson_plan_requests.retry_count` (written by `lesson-plan-queue.service.js`) ← read by `bot/shared/services/monitoring/lesson-plan-health.service.js:331:5809b3eb`
- column `lesson_plan_requests.source` (written by `lesson-plan-queue.service.js`) ← read by `bot/shared/services/lp-v8-lifecycle.service.js:46:9a74e573` · `bot/shared/services/monitoring/lesson-plan-health.service.js:331:5809b3eb`
- column `lesson_plan_requests.status` (written by `lesson-plan-queue.service.js`, `teacher-state.service.js`) ← read by `bot/shared/services/lesson-plan-queue.service.js:342:184894e4` · `bot/shared/services/lp-v8-lifecycle.service.js:49:df52c07a` · `bot/shared/services/monitoring/lesson-plan-health.service.js:331:5809b3eb` · `bot/shared/services/teacher-state.service.js:94:28233e00`
- column `lesson_plan_requests.textbook_metadata` (written by `lesson-plan-queue.service.js`) ← read by `bot/shared/services/monitoring/lesson-plan-health.service.js:331:5809b3eb`
- column `lesson_plan_requests.topic` (written by `lesson-plan-queue.service.js`) ← read by `bot/shared/services/teacher-state.service.js:252:6012f2a7`
- column `lesson_plan_requests.user_id` (written by `lesson-plan-queue.service.js`) ← read by `bot/shared/services/lp-v8-lifecycle.service.js:45:219f5683` · `bot/shared/services/monitoring/lesson-plan-health.service.js:344:b19b951d` · `bot/shared/services/teacher-state.service.js:95:219f5683`
- column `lesson_plans.content` (written by `lp-v8-delivery.service.js`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797`
- column `lesson_plans.grade` (written by `lp-v8-delivery.service.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `dashboard/routes/portal.routes.js:2609:bfdc3284` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` (+3: `python3 kg/kg.py who-reads lesson_plans.grade`)
- column `lesson_plans.subject` (written by `lp-v8-delivery.service.js`) ← read by `dashboard/routes/portal.routes.js:2609:bfdc3284` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+2: `python3 kg/kg.py who-reads lesson_plans.subject`)
- column `lesson_plans.topic` (written by `lp-v8-delivery.service.js`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `dashboard/routes/portal-teacher-home.routes.js:149:b5b1a628` · `dashboard/routes/portal.routes.js:2609:bfdc3284` (+4: `python3 kg/kg.py who-reads lesson_plans.topic`)
- column `lesson_plans.type` (written by `lp-v8-delivery.service.js`) ← read by `dashboard/database/queries.js:718:e125cbb9` · `dashboard/routes/portal.routes.js:2609:bfdc3284` · `bot/shared/services/lp-feedback.service.js:268:e461c55d`
- column `lesson_plans.user_id` (written by `lp-v8-delivery.service.js`) ← read by `bot/shared/database/bot-helpers.js:413:219f5683` · `bot/shared/routes/quiz-flow-endpoint.js:160:219f5683` · `dashboard/database/queries.js:817:400b923c` · `dashboard/routes/portal-teacher-home.routes.js:144:acedf831` (+9: `python3 kg/kg.py who-reads lesson_plans.user_id`)
- column `reading_assessments.grade_level` (written by `reading-assessment.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1735:28adfbcc` · `bot/shared/handlers/voice-message.handler.js:414:d5870428` · `bot/whatsapp-bot.js:1197:d5870428` · `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.language` (written by `reading-assessment.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1735:28adfbcc` · `bot/shared/handlers/voice-message.handler.js:324:41c35e65` · `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.passage_type` (written by `reading-assessment.service.js`) ← read by `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.status` (written by `reading-assessment.service.js`, `redis-comprehension.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:490:1099729a` · `bot/workers/stale-session.worker.js:279:99a7da90` · `dashboard/database/queries.js:750:a69ef692` · `dashboard/routes/portal.routes.js:8261:a69ef692` (+3: `python3 kg/kg.py who-reads reading_assessments.status`)
- column `reading_assessments.student_identifier` (written by `reading-assessment.service.js`) ← read by `dashboard/routes/portal.routes.js:8259:6033d135`
- column `reading_assessments.user_id` (written by `reading-assessment.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:491:a819c701` · `bot/workers/stale-session.worker.js:280:219f5683` · `dashboard/database/queries.js:819:0a954284` · `dashboard/routes/portal.routes.js:8260:219f5683` (+4: `python3 kg/kg.py who-reads reading_assessments.user_id`)
- column `student_lists.is_active` (written by `student-list.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:389:f8c426e2` · `bot/shared/routes/quiz-flow-endpoint.js:123:f8c426e2` · `bot/whatsapp-bot.js:1454:f8c426e2` · `bot/shared/services/attendance-portal.service.js:247:f8c426e2` (+12: `python3 kg/kg.py who-reads student_lists.is_active`)
- column `students.is_active` (written by `student-list.service.js`, `student-mode.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:332:f8c426e2` · `bot/shared/routes/edit-class-endpoint.js:47:f8c426e2` · `bot/shared/services/attendance-register-delivery.service.js:121:3d987916` · `bot/shared/services/attendance-router.service.js:128:f8c426e2` (+24: `python3 kg/kg.py who-reads students.is_active`)
- column `users.portal_invite_expires_at` (written by `feature-registration.service.js`, `portal-invite.service.js`) ← read by `dashboard/routes/portal.routes.js:482:74e8e3d0` · `bot/shared/services/portal-invite.service.js:203:d17654ef`
- column `users.portal_invite_token` (written by `feature-registration.service.js`, `portal-invite.service.js`) ← read by `dashboard/routes/portal.routes.js:483:53285ac9` · `bot/shared/services/portal-invite.service.js:204:53285ac9`
- column `users.registration_completed` (written by `feature-registration.service.js`) ← read by `bot/shared/database/queries.js:106:fef21f32` · `dashboard/database/queries.js:760:d3561f41` · `dashboard/routes/hcp.routes.js:234:a3c35625` · `dashboard/routes/portal.routes.js:680:b547e081` (+3: `python3 kg/kg.py who-reads users.registration_completed`)
- column `users.registration_started_at` (written by `registration-invite.service.js`) ← read by `bot/shared/services/feature-registration.service.js:48:8579cb74`
- table `ab_test_variants` whole row (`*`) (written by `bandit.service.js`) ← read by `dashboard/index.js:1137:d2b02c3e`?
- table `coaching_sessions` whole row (`*`) (written by `coaching-orchestrator.service.js`, `teacher-state.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `dashboard/database/queries.js:733:7a0c163a`? (+11: `python3 kg/kg.py who-reads coaching_sessions`)
- table `curriculum_lp_ast` whole row (`*`) (written by `curriculum-lp-ast.service.js`) ← read by `bot/scripts/migration/survey-lp-counts.js:22:fdae4b2f`? · `bot/scripts/render/render-one-lp.js:115:d61f3f19`? · `bot/scripts/render/render-v7-lp.js:56:94380945`?
- table `lesson_plan_requests` whole row (`*`) (written by `lesson-plan-queue.service.js`, `teacher-state.service.js`) ← read by `bot/scripts/requeue-lesson-plan.js:42:d2b02c3e`?
- table `lesson_plans` whole row (`*`) (written by `lp-v8-delivery.service.js`) ← read by `dashboard/database/queries.js:717:7a0c163a`? · `bot/shared/services/feature-registration.service.js:135:7a0c163a`?
- table `reading_assessments` whole row (`*`) (written by `reading-assessment.service.js`, `redis-comprehension.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:517:d2b02c3e`? · `dashboard/database/queries.js:749:7a0c163a`? · `dashboard/routes/portal.routes.js:8334:d2b02c3e`? · `bot/shared/services/feature-registration.service.js:147:7a0c163a`? (+2: `python3 kg/kg.py who-reads reading_assessments`)
- table `students` whole row (`*`) (written by `student-mode.service.js`) ← read by `bot/shared/services/student-list.service.js:362:d2b02c3e`?
- table `textbook_toc` whole row (`*`) (written by `toc-loading.service.js`) ← read by `bot/shared/services/topic-matching.service.js:39:46cc8fc8`?
- table `users` whole row (`*`) (written by `conversation-state.service.js`, `feature-registration.service.js`, `portal-invite.service.js`, `registration-invite.service.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:314:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `ab_test_variants` (written by `bandit.service.js`) ← read by `dashboard/index.js:1136:f4ca97a1`?
- table `assessment_requests` (written by `portal-ready-whatsapp.service.js`) ← read by `dashboard/routes/portal.routes.js:1193:b7d7c184`? · `dashboard/services/teacher-home-order.service.js:231:b5e302a6`? · `bot/shared/services/assessment/assessment-browse.service.js:249:b7d7c184`? · `bot/shared/services/assessment/assessment-request.service.js:107:b7d7c184`? (+1: `python3 kg/kg.py who-reads assessment_requests`)
- table `attendance_records` (written by `attendance-write.service.js`) ← read by `bot/shared/services/attendance-portal.service.js:319:cfe741c3`?
- table `attendance_sessions` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:909:2a982732`? · `dashboard/routes/portal.routes.js:1432:70a65915`? · `dashboard/services/teacher-home-order.service.js:232:57e1664c`? · `bot/shared/services/attendance-portal.service.js:293:2a982732`? (+1: `python3 kg/kg.py who-reads attendance_sessions`)
- table `coach_visit_requests` (written by `coach-voice-note-retention.service.js`) ← read by `dashboard/routes/coach-card.routes.js:33:d4b16243`? · `dashboard/routes/portal.routes.js:2325:1fdcb761`? · `dashboard/services/coach-disagreement-plan.js:29:9ee72eab`? · `dashboard/services/coach-disagreements.service.js:137:b161c5cf`? (+1: `python3 kg/kg.py who-reads coach_visit_requests`)
- table `coaching_sessions` (written by `coaching-orchestrator.service.js`, `teacher-state.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- table `curriculum_lp_ast` (written by `curriculum-lp-ast.service.js`) ← read by `bot/scripts/migration/import-tbcore-lps.js:274:fe1db9e9`? · `bot/scripts/migration/survey-lp-inventory.js:37:fe1db9e9`?
- table `lesson_plan_requests` (written by `lesson-plan-lifecycle.service.js`, `lesson-plan-queue.service.js`, `teacher-state.service.js`) ← read by `bot/shared/routes/homework-request-endpoint.js:225:f61b5e94`? · `bot/workers/homework-bundle.worker.js:124:956ee1e9`? · `bot/scripts/requeue-lesson-plan.js:41:f61b5e94`? · `bot/shared/services/lesson-plan-queue.service.js:50:f61b5e94`? (+3: `python3 kg/kg.py who-reads lesson_plan_requests`)
- table `lesson_plans` (written by `lp-v8-delivery.service.js`) ← read by `bot/shared/database/bot-helpers.js:411:611f2601`? · `bot/shared/routes/quiz-flow-endpoint.js:158:611f2601`? · `bot/workers/homework-bundle.worker.js:178:611f2601`? · `bot/workers/quiz-job-handler.js:346:611f2601`? (+12: `python3 kg/kg.py who-reads lesson_plans`)
- table `lp_feedback` (written by `lp-feedback.service.js`) ← read by `bot/scripts/migration/apply-017-lp-feedback.js:74:3f0e2a4e`?
- table `niete_lp612_deliveries` (written by `portal-ready-whatsapp.service.js`) ← read by `bot/shared/services/lp-app-open-survey.service.js:96:e6842ada`? · `bot/shared/services/share-send.service.js:125:57a90568`?
- table `niete_lp612_renders` (written by `lp612-serving.service.js`) ← read by `bot/shared/services/coaching/portal-lesson-plan-library.service.js:117:3534712c`?
- table `niete_lp_downloads` (written by `lp-v8-delivery.service.js`) ← read by `bot/shared/calls/call-tools.repo.js:123:bdffbacd`? · `bot/shared/services/coaching/analysis-processor.service.js:88:bdffbacd`? · `bot/shared/services/coaching/lp-coaching/recent-fidelity-lps.service.js:48:bdffbacd`? · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:95:bdffbacd`? (+6: `python3 kg/kg.py who-reads niete_lp_downloads`)
- table `reading_assessments` (written by `reading-assessment.service.js`, `redis-comprehension.service.js`) ← read by `bot/shared/handlers/flow-response.handler.js:326:4337985e`? · `bot/shared/handlers/text-message.handler.js:1734:4337985e`? · `bot/shared/handlers/voice-message.handler.js:323:4337985e`? · `bot/whatsapp-bot.js:1196:4337985e`? (+11: `python3 kg/kg.py who-reads reading_assessments`)
- table `student_lists` (written by `student-list.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:298:8479d615`? · `bot/shared/routes/attendance-setup-endpoint.js:174:8479d615`? · `bot/shared/routes/edit-class-endpoint.js:33:8479d615`? · `bot/shared/routes/quiz-flow-endpoint.js:120:8479d615`? (+23: `python3 kg/kg.py who-reads student_lists`)
- table `students` (written by `student-list.service.js`, `student-mode.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? · `bot/shared/routes/roster-flow-endpoint.js:775:3776d591`? · `bot/shared/routes/student-videos-endpoint.js:266:d71c8cd6`? (+42: `python3 kg/kg.py who-reads students`)
- table `teacher_attendance_records` (written by `attendance-write.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:898:cac7d040`? · `bot/workers/attendance-bigquery-export.worker.js:141:cac7d040`? · `dashboard/routes/portal.routes.js:1448:271b593d`? · `dashboard/services/attendance-repository.service.js:118:cac7d040`? (+1: `python3 kg/kg.py who-reads teacher_attendance_records`)
- table `textbook_toc` (written by `toc-loading.service.js`) ← read by `bot/scripts/import-assessment-topics.js:121:2986a134`? · `bot/scripts/migration/survey-lp-inventory.js:83:10cc8589`? · `scripts/assessment/eval-run.js:80:5ce6536d`? · `bot/shared/services/assessment/assessment-browse.service.js:97:10cc8589`? (+1: `python3 kg/kg.py who-reads textbook_toc`)
- table `user_feature_first_use` (written by `app-redirect.service.js`, `feature-intro.service.js`) ← read by `bot/shared/services/app-redirect.service.js:454:f6f893d9`? · `bot/shared/services/feature-intro.service.js:53:f6f893d9`?
- table `users` (written by `conversation-state.service.js`, `feature-registration.service.js`, `portal-invite.service.js`, `registration-invite.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+171: `python3 kg/kg.py who-reads users`)
- env `ANTHROPIC_API_KEY` read at `bot/shared/services/llm-client.js:903:5bd0a625`
- env `APP_SETTINGS_FLAG_TTL_MS` read at `bot/shared/services/webhook-signature.js:45:7b1a7c4a`
- env `APP_URL` read at `bot/shared/services/llm-client.js:278:a6f65934`
- env `ASSESSMENT_GEN_FLOW_ID` read at `bot/shared/services/assessment-entry.service.js:60:8d81faaf`
- env `ASSETS_BASE_URL` read at `bot/shared/services/whatsapp.service.js:26:0038e54c`
- env `ASSET_BASE_URL` read at `bot/shared/services/whatsapp.service.js:26:0038e54c`
- env `ATTENDANCE_MARKING_FLOW_ID` read at `bot/shared/services/attendance-entry.service.js:36:cf8f1933`
- env `AWS_ACCESS_KEY_ID` read at `bot/shared/services/aws-textract.service.js:26:b483921a`
- env `AWS_REGION` read at `bot/shared/services/aws-textract.service.js:13:2159a2a4`
- env `AWS_REGION_TEXTRACT` read at `bot/shared/services/aws-textract.service.js:12:a26563a0`
- env `AWS_SECRET_ACCESS_KEY` read at `bot/shared/services/aws-textract.service.js:27:e849d03f`
- env `AWS_TEXTRACT_ACCESS_KEY_ID` read at `bot/shared/services/aws-textract.service.js:26:b483921a`
- env `AWS_TEXTRACT_SECRET_ACCESS_KEY` read at `bot/shared/services/aws-textract.service.js:27:e849d03f`
- env `CLASS_MANAGER_FLOW_ID` read at `bot/shared/services/attendance-entry.service.js:37:6b4d902d`
- env `CONTENT_R2_PUBLIC_URL` read at `bot/shared/services/fln-index.service.js:33:51af1dc1`
- env `E2E_CASSETTE` read at `bot/shared/services/e2e-cassette.js:40:07680cff`
- env `E2E_CASSETTE_DIR` read at `bot/shared/services/e2e-cassette.js:135:337bbae4`
- env `E2E_CASSETTE_FAULTS` read at `bot/shared/services/e2e-cassette.js:200:56d3d343`
- env `E2E_CASSETTE_MISS_DUMP` read at `bot/shared/services/e2e-cassette.js:280:eb630f38`
- env `E2E_CASSETTE_MISS_LOG` read at `bot/shared/services/e2e-cassette.js:65:4d04976b`
- env `E2E_CASSETTE_TRACE_LOG` read at `bot/shared/services/e2e-cassette.js:59:6dd4476d`
- env `EDIT_CLASS_FLOW_ID` read at `bot/shared/services/attendance-entry.service.js:38:2ef608a6`
- env `ELEVENLABS_FALLBACK_API_KEY` read at `bot/shared/services/elevenlabs.service.js:48:8cbb71c9`
- env `ENVIRONMENT` read at `bot/shared/services/outbound-echo.js:27:f1339dc3`
- env `FLN_CORPUS_BASE` read at `bot/shared/services/fln-index.service.js:31:3ea42c05`
- env `FLN_CORPUS_VERSION` read at `bot/shared/services/fln-index.service.js:58:46609226`
- env `FLN_SEND_TEMPLATE` read at `bot/shared/services/fln-send.service.js:59:8a961bac`
- env `FLOW_PRIVATE_KEY` read at `bot/shared/services/flow-encryption.service.js:28:88878a86`
- env `FLOW_PRIVATE_KEY_B64` read at `bot/shared/services/flow-encryption.service.js:32:656d99e1`
- env `FLOW_PUBLIC_KEY` read at `bot/shared/services/flow-encryption.service.js:40:8e365b1d`
- env `FLOW_PUBLIC_KEY_B64` read at `bot/shared/services/flow-encryption.service.js:44:b7774d7f`
- env `GRAPH_API_VERSION` read at `bot/shared/services/whatsapp.service.js:64:ddcada1f`
- env `INBOUND_TYPING_DEFER_MS` read at `bot/shared/services/inbound-typing.js:103:f3a2211b`
- env `INBOUND_TYPING_QUIET_HOLD_MS` read at `bot/shared/services/inbound-typing.js:91:a13362bb`
- env `INTERNAL_API_KEY` read at `bot/shared/services/app-login-link.js:108:237d5f3b` · `bot/shared/services/fln-keys.js:36:237d5f3b` · `bot/shared/services/portal-link-token.js:58:3d849406`
- env `LLM_DIRECT_FALLBACK_MODEL` read at `bot/shared/services/llm-client.js:138:eb940686`
- env `LLM_FALLBACK_OFF` read at `bot/shared/services/llm-client.js:239:b0507923`
- env `LLM_JOB_MODELS` read at `bot/shared/services/llm-client.js:394:8f569dc1`
- env `LLM_MAX_RETRIES` read at `bot/shared/services/llm-client.js:89:08721dbe`
- env `LLM_MODEL` read at `bot/shared/services/llm-client.js:42:8ac80d3e`
- env `LLM_PROVIDER` read at `bot/shared/services/llm-client.js:41:50f26a4f`
- env `LLM_REQUEST_TIMEOUT_MS` read at `bot/shared/services/llm-client.js:85:95d13c97`
- env `LP612_AUTHOR_ROUNDS` read at `bot/shared/services/lp612-author.service.js:102:5dafcae7`
- env `LP612_DELIVER_TRUNCATED` read at `bot/shared/services/lp612-render-policy.service.js:81:8e14b516`
- env `LP612_PAGE_TRUTH_DIR` read at `bot/shared/services/lp612-pagetruth.service.js:181:1eda2971`
- env `LP612_RENDER_CONCURRENCY` read at `bot/shared/services/lp612-render.service.js:92:a31d9c3f`
- env `LP612_RENDER_EXPECTED_MS` read at `bot/shared/services/lp612-render.service.js:145:3f753759`
- env `LP_CONTEXT_V2_ENABLED` read at `bot/shared/services/lp-context.service.js:734:2e821a33`
- env `LP_LIFECYCLE_PATHS` read at `bot/shared/services/lesson-plan-lifecycle.service.js:118:cdca6d3a`
- env `OPENAI_API_KEY` read at `bot/shared/services/llm-client.js:245:610da071`
- env `OPENROUTER_API_KEY` read at `bot/shared/services/llm-client.js:172:d9fb0214`
- env `PAKISTAN_LP_FLOW_ID` read at `bot/shared/services/lp-browse-entry.service.js:78:f3637211`
- env `PORTAL_KEYWORD_ROUTING` read at `bot/shared/services/portal-request.js:71:fa0acd26`
- env `R2_ACCESS_KEY_ID` read at `bot/shared/services/e2e-cassette.js:152:17e923a9`
- env `R2_BUCKET_NAME` read at `bot/shared/services/e2e-cassette.js:152:17e923a9`
- env `R2_ENDPOINT` read at `bot/shared/services/e2e-cassette.js:152:17e923a9`
- env `R2_SECRET_ACCESS_KEY` read at `bot/shared/services/e2e-cassette.js:152:17e923a9`
- env `RAILWAY_ENVIRONMENT_NAME` read at `bot/shared/services/outbound-echo.js:27:f1339dc3`
- env `READING_ASSESSMENT_FLOW_ID` read at `bot/shared/services/menu.service.js:280:59967b0b`
- env `REGION` read at `bot/shared/services/lesson-plan-lifecycle.service.js:165:f9a81cf6`
- env `REGISTRATION_FLOW_ID` read at `bot/shared/services/feature-registration.service.js:62:7eaa3f43` · `bot/shared/services/registration-invite.service.js:138:303395c9`
- env `ROSTER_FLOW_ID` read at `bot/shared/services/roster-entry.service.js:44:0d3c39c9`
- env `STUDENT_VIDEOS_FLOW_ID` read at `bot/shared/services/student-videos-entry.service.js:26:0389e3b2`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `bot/shared/services/redis-comprehension.service.js:21:90118d4a`
- env `SUPABASE_URL` read at `bot/shared/services/app-login-link.js:96:a60b88ec` · `bot/shared/services/e2e-cassette.js:42:2e19eb18` · `bot/shared/services/fln-keys.js:24:a60b88ec` · `bot/shared/services/redis-comprehension.service.js:20:e84bc099`
- env `WA_OUTBOUND_ECHO_TO` read at `bot/shared/services/outbound-echo.js:32:987ad6d1`
- env `WA_PAIR_BURST` read at `bot/shared/services/whatsapp-send-pacer.js:119:8f7e42c1`
- env `WA_PAIR_INTERVAL_MS` read at `bot/shared/services/whatsapp-send-pacer.js:118:32fbd416`
- env `WA_PAIR_MAX_WAIT_MS` read at `bot/shared/services/whatsapp-send-pacer.js:120:2eb4e7a2`
- env `WA_PAIR_PACING` read at `bot/shared/services/whatsapp-send-pacer.js:117:d0a940f7`
- env `WA_RATE_LIMIT_MAX_ATTEMPTS` read at `bot/shared/services/whatsapp-send-pacer.js:121:2107618a`
- env `WA_RATE_LIMIT_RETRY_BASE_MS` read at `bot/shared/services/whatsapp-send-pacer.js:122:921af4af`
- env `WEB_TRAINING_TOKEN_SECRET` read at `bot/shared/services/portal-link-token.js:56:e13bdf96`
- env `WHATSAPP_API_BASE` read at `bot/shared/services/whatsapp.service.js:68:f162a17a`
- env `WHATSAPP_APP_SECRET` read at `bot/shared/services/webhook-signature.js:68:80f1ed46`
- env `WHATSAPP_WEBHOOK_SIGNATURE_MODE` read at `bot/shared/services/webhook-signature.js:67:1242116a`

## Tests (all, generated)
- `anthropic-native-facade.js` ← `tests/llm/anthropic-facade-translation.test.js` · `tests/llm/direct-lane-system-note-position.test.js` · `tests/llm/facade-dated-model-price.test.js` · `tests/llm/haiku-5-5-direct-lane.test.js` · `tests/llm/job-override-hardening.test.js` · `tests/llm/sonnet-5-5-price.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/anthropic-native-facade.js`)
- `app-journey.js` ← `tests/app-funnel/app-login-journey.test.js` · `tests/app-funnel/journey-token.test.js` · `tests/app-funnel/route-parity.test.js` · `tests/app-redirect/app-link-leader-lesson-plan.test.js`
- `app-login-link.js` ← `bot/tests/first-touch/teacher-home.portal-link.test.js` · `tests/app-funnel/app-login-journey.test.js` · `tests/app-funnel/bot-journey-events.test.js` · `tests/app-funnel/journey-token.test.js` · `tests/app-redirect/app-link-coach-school-card-door.test.js` · `tests/app-redirect/app-link-coach-school-card.test.js` (+26: `python3 kg/kg.py who-reads bot/shared/services/app-login-link.js`)
- `app-redirect.service.js` ← `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/handlers/reversed-slash-command.test.js` · `tests/app-funnel/bot-journey-events.test.js` · `tests/app-redirect/app-link-coach-school-card.test.js` · `tests/app-redirect/app-link-coach-training.test.js` · `tests/app-redirect/app-link-coach.test.js` (+9: `python3 kg/kg.py who-reads bot/shared/services/app-redirect.service.js`)
- `assessment-entry.service.js` ← `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `tests/app-redirect/app-redirect-routing.test.js` · `tests/handlers/feature-doors.test.js`
- `attendance-entry.service.js` ← `tests/handlers/feature-doors.test.js`
- `attendance-portal.service.js` ← `tests/attendance/bd-fmf24g.7-attendance-portal.test.js`
- `attendance-register-delivery.service.js` ← `tests/attendance/register-delivery-temp-race.test.js` · `tests/attendance/register-delivery.test.js` · `tests/attendance/student-flow-four-asks.test.js`
- `attendance-register.service.js` ← `tests/attendance/monthly-register.test.js` · `tests/attendance/student-flow-four-asks.test.js`
- `attendance-router.service.js` ← `bot/tests/lp-v8/lp-shelf-flush-points.test.js` · `tests/attendance/attendance-no-class-creation.test.js` · `tests/attendance/attendance-router.test.js` · `tests/attendance/completion-classified-from-token.test.js` · `tests/attendance/empty-roster-dead-end.test.js` · `tests/attendance/enrollment-roster-source.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/attendance-router.service.js`)
- `attendance-write.service.js` ← `tests/attendance/attendance-write.test.js`
- `audio.service.js` ← `bot/tests/observe/bd-tju8f-audio-wall.test.js` · `bot/tests/quiz/one-voice-missing-keys.test.js` · `bot/tests/quiz/web-quiz/challenge-counted-meta.test.js` · `bot/tests/quiz/web-quiz/challenge-read-quality.test.js` · `bot/tests/quiz/web-quiz/challenge-record-guards.test.js` · `bot/tests/quiz/web-quiz/challenge-serve-v2.test.js` (+18: `python3 kg/kg.py who-reads bot/shared/services/audio.service.js`)
- `aws-textract.service.js` ← `tests/coaching/bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js`
- `coach-school-target.js` ← `tests/app-redirect/app-link-coach-school-card.test.js` · `tests/app-redirect/app-login-coach-school.test.js`
- `coach-voice-note-retention.service.js` ← `bot/tests/services/coach-voice-note-retention.test.js` · `bot/tests/workers/coach-voice-note-sweep.test.js`
- `coaching-orchestrator.service.js` ← `bot/tests/observe/bd-2kxxa2-media-target.test.js` · `bot/tests/observe/bd-o8nt4-principal-self-coaching.test.js` · `tests/coaching/bd-59840-honest-wait-no-ack.test.js` · `tests/coaching/bd-fmf24g.9-teacher-class.test.js` · `tests/coaching/meta-bill-nc1-confirm-carries-wait.test.js` · `tests/handlers/bd-c5reix-doors-keep-recording.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/coaching-orchestrator.service.js`)
- `content.service.js` ← `tests/lesson-plan-lifecycle/grounded-path.test.js`
- `conversation-resume.service.js` ← `tests/conversation-state/flows-on-the-store.test.js` · `tests/conversation-state/recording-ends-coaching-wait.test.js` · `tests/conversation-state/resume-offer.test.js` · `tests/conversation-state/resume-quiet-hours.test.js` · `tests/conversation-state/sweep-does-not-clobber.test.js` · `tests/status/status-internal-ids.test.js`
- `conversation-state.service.js` ← `bot/tests/first-touch/one-door-text-turn.test.js` · `tests/app-redirect/app-link-leader-lessons-doors.test.js` · `tests/attendance/voice-session-state.contract.test.js` · `tests/conversation-state/clear-expired.contract.test.js` · `tests/conversation-state/recording-ends-coaching-wait.test.js` · `tests/conversation-state/resume-quiet-hours.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/conversation-state.service.js`)
- `curriculum-lp-ast.service.js` ← `bot/tests/handlers/lesson-plan-v2.handler.test.js` · `bot/tests/services/curriculum-lp-ast.findByTopic.test.js` · `tests/lesson-plan-lifecycle/requeue-grounded.test.js`
- `e2e-cassette.js` ← `bot/tests/unit/e2e-cassette.test.js` · `tests/e2e-mock/cassette-key-ignores-telemetry.test.js` · `tests/e2e-mock/cassette-strict.test.js` · `tests/e2e-mock/cassette-trace.test.js` · `tests/quiz/e2e-cassette-faults.test.js` · `tests/tts/gateway.test.js`
- `elevenlabs.service.js` ← `bot/tests/lp-v8/elevenlabs-key-fallback.test.js` · `bot/tests/lp-v8/voice-reply-quality.test.js` · `tests/coaching/elevenlabs-lazy-openai.test.js` · `tests/coaching/urdu-tts-decimals.test.js`
- `feature-intro.service.js` ← `bot/tests/quiz/bd-v0toag-126-quiz-offer-window.test.js` · `bot/tests/welcome/bd-oak77.13-ice-breakers.test.js` · `tests/coaching/first-use-intro-one-message.test.js` · `tests/lp-v8/lp-coaching-ask-send.test.js` · `tests/quiz/feature-intro-count.test.js` · `tests/quiz/transcript-quiz-intro-video.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/feature-intro.service.js`)
- `feature-keyword-detector.service.js` ← `bot/tests/lp-v8/bd-wssa3-no-lp-keyword-nudge.test.js`
- `feature-linker.service.js` ← `tests/coaching/bd-x3k1q-session-complete-boundary.test.js` · `tests/reading/reading-availability-gate.test.js`
- `feature-registration.service.js` ← `bot/tests/first-touch/one-door-text-turn.test.js` · `bot/tests/registration/bd-2447-register-command-sends-flow.test.js` · `bot/tests/registration/bd-2kxxa1-register-reopens-for-registered.test.js` · `bot/tests/registration/bug-002-registration-recovery.test.js` · `tests/registration/after-first-feature-invite.test.js` · `tests/registration/bd-oak77-6-named-user-is-registered.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/feature-registration.service.js`)
- `fln-go-target.js` ← `tests/routes/fln-go-target.test.js`
- `fln-keys.js` ← `tests/portal/fln-send-routes.test.js` · `tests/portal/fln-userkey-helper.test.js` · `tests/routes/fln-keys.test.js`
- `fln-send.service.js` ← `tests/routes/fln-send.service.test.js` · `tests/routes/internal-fln-send.test.js`
- `fln-send.strings.js` ← `tests/routes/fln-send.service.test.js`
- `flow-encryption.service.js` ← `tests/child-test/L14/check-play.test.js` · `tests/child-test/L6/endpoint.test.js` · `tests/e2e-mock/flow-emulator.test.js` · `tests/setup/flow-encryption-method-conformance.test.js` · `tests/whatsapp/webhook-signature.test.js`
- `gpt5-mini.service.js` ← `bot/tests/coaching/reflective-question-english-contract.test.js` · `bot/tests/observe/bd-2kxxa3-debrief-transcription-failure.test.js` · `bot/tests/observe/bd-c3uq9-notes-language.test.js` · `bot/tests/observe/bd-dy7hs-one-language-owner.test.js` · `bot/tests/observe/bd-zpyf0-confirm-names-recipient.test.js` · `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` (+34: `python3 kg/kg.py who-reads bot/shared/services/gpt5-mini.service.js`)
- `helper-agent.service.js` ← `bot/tests/i18n/slash-command-bidi.test.js` · `tests/menu/stale-menu-wait.test.js` · `tests/registration/front-door-invite.test.js`
- `homework-lookup.service.js` ← `tests/homework/homework-flow.test.js`
- `inbound-typing.js` ← `tests/meta-bill-cut/fx3-silent-turn-typing.test.js` · `tests/meta-bill-cut/fx4-round3.test.js` · `tests/meta-bill-cut/fx6-round4.test.js` · `tests/whatsapp/inbound-typing-scope.test.js`
- `language-detector.service.js` ← `tests/handlers/voice-language-floor.test.js` · `tests/llm/single-source-e2e.test.js`
- `lesson-plan-lifecycle.service.js` ← `tests/lesson-plan-lifecycle/queue-own-row-read-failed.test.js` · `tests/lesson-plan-lifecycle/vocabulary.test.js` · `tests/lesson-plan-lifecycle/writer.test.js`
- `lesson-plan-queue.service.js` ← `bot/tests/lp-v8/bd-oak77-cutover-inflight.test.js` · `tests/app-redirect/app-link-leader-lessons-rescue.test.js` · `tests/fflp/queue-worker.test.js` · `tests/lesson-plan-lifecycle/generation-failed-attempts.test.js` · `tests/lesson-plan-lifecycle/grounded-path.test.js` · `tests/lesson-plan-lifecycle/queue-own-row-read-failed.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/lesson-plan-queue.service.js`)
- `lesson-plan-template.service.js` ← `bot/tests/services/lesson-plan-template.grounded.test.js` · `tests/textbook-lp-v2/lesson-plan-template.test.js`
- `lesson-plans-web-link.js` ← `tests/lp-v8/web-lessons-link.test.js`
- `llm-client.js` ← `bot/tests/llm-cost-attributed.test.js` · `bot/tests/llm-cost-recorded.test.js` · `bot/tests/llm-fallback-armed.test.js` · `bot/tests/llm-vendor-fallback.test.js` · `bot/tests/quiz/web-quiz/challenge-counted-meta.test.js` · `bot/tests/quiz/web-quiz/challenge-read-quality.test.js` (+67: `python3 kg/kg.py who-reads bot/shared/services/llm-client.js`)
- `lp-ab-ch310.service.js` ← `bot/tests/lp-v8/ab-ch310.test.js` · `tests/quiz/lp-app-opens-served-and-listed.test.js`
- `lp-app-open-survey.service.js` ← `tests/lesson-plan-lifecycle/v8-portal-path.test.js` · `tests/lp-v8/app-open-survey-fln.test.js` · `tests/lp-v8/app-open-survey.test.js`
- `lp-browse-entry.service.js` ← `bot/tests/first-touch/maker-fallback.test.js` · `bot/tests/lp-v8/bd-hgwfo-gamma-door.test.js` · `tests/app-redirect/app-redirect-routing.test.js` · `tests/lp-v8/meta-bill-nl3-redirect-in-flow.test.js` · `tests/lp-v8/web-lessons-link.test.js`
- `lp-context.service.js` ← `bot/tests/lp-v8/bd-wpupy-followup-context.test.js` · `bot/tests/lp-v8/lp-context-app-opens.test.js` · `bot/tests/lp-v8/lp-context-builder.test.js` · `bot/tests/lp-v8/lp-context-gate.test.js` · `bot/tests/lp-v8/religious-reverence.test.js` · `tests/lp612/context-one-screen.test.js`
- `lp-delivery-marker.service.js` ← `bot/tests/lp-v8/bd-wpupy-delivery-marker.test.js`
- `lp-describe.service.js` ← `tests/portal/fln-readers.test.js`
- `lp-feedback.service.js` ← `bot/scripts/e2e/lp-feedback-e2e.js` · `bot/tests/handlers/portal-bare-word.test.js` · `bot/tests/lp-v8/lp-shelf-plumbing.test.js` · `bot/tests/lp-v8/voicenote-survey.test.js` · `bot/tests/services/lp-feedback.service.test.js` · `tests/lp-v8/app-open-survey.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/lp-feedback.service.js`)
- `lp-shelf.service.js` ← `bot/tests/lp-v8/lp-shelf-flush-points.test.js` · `bot/tests/lp-v8/lp-shelf-plumbing.test.js` · `tests/quiz/lp-shelf.test.js`
- `lp-v10-card.service.js` ← `tests/lp-v8/lp-v10-card.test.js`
- `lp-v8-browse.service.js` ← `bot/tests/lp-v8/ab-ch310.test.js` · `bot/tests/lp-v8/portal-subject-order.test.js` · `bot/tests/lp-v8/tick-app-opens.test.js` · `tests/lp-v8/lp-v10-card-wiring.test.js` · `tests/lp-v8/split-lesson-consumers.test.js`
- `lp-v8-catalog.service.js` ← `bot/tests/lp-v8/ab-ch310.test.js` · `bot/tests/lp-v8/bd-oak77-endpoint-route-all.test.js` · `bot/tests/lp-v8/delivery.test.js` · `bot/tests/lp-v8/elective-menu-names.test.js` · `bot/tests/lp-v8/endpoint-dispatch.test.js` · `bot/tests/lp-v8/endpoint-items.test.js` (+29: `python3 kg/kg.py who-reads bot/shared/services/lp-v8-catalog.service.js`)
- `lp-v8-delivery.service.js` ← `bot/tests/lp-v8/ab-ch310.test.js` · `bot/tests/lp-v8/delivery.test.js` · `bot/tests/lp-v8/live-schema-limits.test.js` · `bot/tests/lp-v8/lp-shelf-plumbing.test.js` · `bot/tests/lp-v8/portal-subject-order.test.js` · `bot/tests/lp-v8/voicenote-delivery.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/lp-v8-delivery.service.js`)
- `lp-v8-lifecycle.service.js` ← `tests/lesson-plan-lifecycle/v8-portal-path.test.js`
- `lp-vision-ocr.service.js` ← `tests/coaching/lp-vision-ocr.test.js`
- `lp-voicenote-script.service.js` ← `bot/tests/lp-v8/lp-shelf-plumbing.test.js`
- `lp612-author.service.js` ← `tests/lp612/author-advisory-prompt.test.js` · `tests/lp612/author-brief-gender-neutral.test.js` · `tests/lp612/author-ladder-stop.test.js` · `tests/lp612/author-religious-marks-blocking.test.js` · `tests/lp612/author-render-gate.test.js` · `tests/lp612/author-schema-tier.test.js` (+29: `python3 kg/kg.py who-reads bot/shared/services/lp612-author.service.js`)
- `lp612-browse.service.js` ← `tests/lp612/portal-browse.test.js` · `tests/lp612/portal-claim.test.js` · `tests/lp612/subject-order.test.js`
- `lp612-catalog.service.js` ← `bot/tests/lp-v8/bd-oak77-endpoint-route-all.test.js` · `tests/lp612/catalog-grades-cap.test.js` · `tests/lp612/catalog-long-names.test.js` · `tests/lp612/catalog-row-consistency.test.js` · `tests/lp612/catalog-rowcap.test.js` · `tests/lp612/catalog-urdu-furniture.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/lp612-catalog.service.js`)
- `lp612-deliveries.store.js` ← `tests/lesson-plan-lifecycle/lp612-leader.test.js` · `tests/lesson-plan-lifecycle/lp612-worker-portal.test.js` · `tests/lp612/delivery-ledger.test.js` · `tests/lp612/portal-claim.test.js`
- `lp612-edit-intent.service.js` ← `tests/llm/job-override-hardening.test.js` · `tests/lp612/edit-router-new-request.test.js`
- `lp612-edit-router.service.js` ← `tests/lp612/edit-router-new-request.test.js` · `tests/lp612/edit-router.test.js`
- `lp612-fbise-tags.js` ← `tests/lp612/fbise-slo-chips.test.js`
- `lp612-feedback.service.js` ← `tests/lp-v8/app-open-survey-fln.test.js` · `tests/lp-v8/app-open-survey.test.js` · `tests/lp-v8/meta-bill-nl1-survey-acks.test.js` · `tests/lp612/feedback.test.js` · `tests/lp612/used-in-class-journey.test.js` · `tests/lp612/used-in-class.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/lp612-feedback.service.js`)
- `lp612-latin-honorific.js` ← `tests/lp612/latin-honorific-normalise.test.js`
- `lp612-lifecycle.service.js` ← `tests/lesson-plan-lifecycle/lp612-leader.test.js` · `tests/lesson-plan-lifecycle/lp612-path.test.js`
- `lp612-overlay-backfill.service.js` ← `tests/lp612/overlay-backfill-over-cap.e2e.test.js` · `tests/lp612/overlay-backfill-over-cap.test.js` · `tests/lp612/overlay-backfill.e2e.test.js` · `tests/lp612/overlay-backfill.test.js` · `tests/lp612/overlay-topup-religious-gate.e2e.test.js` · `tests/lp612/overlay-topup-urdu-gate.e2e.test.js`
- `lp612-overlay-topup.service.js` ← `tests/lp612/overlay-backfill-over-cap.e2e.test.js` · `tests/lp612/overlay-backfill-over-cap.test.js` · `tests/lp612/overlay-backfill.e2e.test.js` · `tests/lp612/overlay-backfill.test.js` · `tests/lp612/overlay-topup.e2e.test.js` · `tests/lp612/overlay-topup.test.js`
- `lp612-pagetruth.service.js` ← `bot/tests/services/lp612-figures-missing-queryable.test.js` · `tests/lp612/page-cap.test.js` · `tests/lp612/pagetruth.test.js` · `tests/lp612/stage-figures.test.js` · `tests/lp612/wide-segment-blast-radius.test.js` · `tests/lp612/wide-segment-delivery.test.js`
- `lp612-render-policy.service.js` ← `tests/lp612/never-fail-delivery.test.js`
- `lp612-render.service.js` ← `tests/lp612/fbise-slo-chips.test.js` · `tests/lp612/figure-repair-telemetry.test.js` · `tests/lp612/overflow-absorb.test.js` · `tests/lp612/overlay-backfill-driver.test.js` · `tests/lp612/overlay-backfill-over-cap.e2e.test.js` · `tests/lp612/overlay-backfill-over-cap.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/services/lp612-render.service.js`)
- `lp612-serving.service.js` ← `bot/tests/services/lp612-renderid-join.test.js` · `tests/lesson-plan-lifecycle/lp612-leader.test.js` · `tests/lesson-plan-lifecycle/lp612-path.test.js` · `tests/lp612/author-worker.test.js` · `tests/lp612/bd-lafr9-onescreen-latex.test.js` · `tests/lp612/bd-oak77-11-reaper-checkpoint.test.js` (+22: `python3 kg/kg.py who-reads bot/shared/services/lp612-serving.service.js`)
- `menu-match.service.js` ← `tests/menu-match/classifier-reads-live-menu.test.js`
- `menu.service.js` ← `bot/tests/bug-003-false-promise.test.js` · `bot/tests/first-touch/first-reply-english.text-turn.test.js` · `bot/tests/first-touch/maker-fallback.test.js` · `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/first-touch/one-door-menu-row.test.js` · `bot/tests/handlers/portal-bare-word.test.js` (+18: `python3 kg/kg.py who-reads bot/shared/services/menu.service.js`)
- `name-extractor.service.js` ← `bot/tests/services/name-extractor.test.js`
- `openai.service.js` ← `bot/tests/bug-003-false-promise.test.js` · `bot/tests/bug-014-video-language.test.js` · `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/lp-v8/bd-eb1ec-context-language-pin.test.js` · `bot/tests/lp-v8/bd-lp-writeout-max-tokens.test.js` · `bot/tests/lp-v8/bd-wpupy-context-position.test.js` (+17: `python3 kg/kg.py who-reads bot/shared/services/openai.service.js`)
- `outbound-echo.js` ← `tests/child-test/L12/outbound-echo.test.js`?
- `oxbridge-lp.service.js` ← `bot/tests/services/oxbridge-lp.service.test.js` · `tests/lesson-plan-lifecycle/legacy-lanes.test.js` · `tests/reports/oxbridge-lp-error-level.test.js`
- `pdf-report.service.js` ← `tests/coaching/bd-gfsja-report-language-join.test.js`
- `phoneless-inbound.js` ← `bot/tests/whatsapp/phoneless-inbound.test.js`
- `portal-invite.service.js` ← `bot/tests/handlers/portal-command-no-password.test.js` · `tests/portal/portal-command-go-link.test.js` · `tests/portal/portal-name-once.test.js`
- `portal-link-token.js` ← `tests/app-redirect/app-login-link.test.js` · `tests/lp-v8/web-lessons-link.test.js` · `tests/lp-v8/web-lessons-portal-link.test.js` · `tests/observe/iab-probe.test.js` · `tests/portal/bd-fmf24g.15-ready-link.test.js` · `tests/portal/bd-fmf24g.15-ready-whatsapp.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/portal-link-token.js`)
- `portal-ready-whatsapp.service.js` ← `tests/portal/bd-fmf24g.15-ready-whatsapp.test.js`
- `portal-request.js` ← `bot/tests/handlers/portal-request.test.js`
- `pregen-lookup.service.js` ← `bot/tests/handlers/lesson-plan-v2.handler.test.js` · `bot/tests/services/pregen-lookup.service.test.js` · `tests/textbook-lp-v2/pregen-lookup.test.js`
- `reaction-only-taps.js` ← `tests/meta-bill-cut/fx7-reaction-only-taps.test.js`
- `reading-assessment.service.js` ← `bot/tests/menu/issue-56-reading-assessment.test.js`
- `redis-comprehension.service.js` ← `tests/handlers/voice-note-temp-collision.test.js`
- `region-features.service.js` ← `bot/tests/handlers/try-curriculum-lp-serve.test.js` · `bot/tests/lp-v8/bd-oak77-route-all.test.js` · `tests/lp-v8/bd-oak77-9-route-all.test.js` · `tests/region/region-features.test.js`
- `registration-invite.service.js` ← `tests/registration/front-door-invite.test.js` · `tests/registration/registration-invite.service.test.js`
- `settings-group.js` ← `bot/tests/quiz/report-send-checked.test.js` · `bot/tests/services/settings-group.test.js`
- `share-send.service.js` ← `bot/tests/coaching/bd-v0toag-127-template-error-detail.test.js` · `tests/lesson-plan-lifecycle/share-path.test.js` · `tests/portal/bd-fmf24g.30-share-send.test.js`
- `soniox-cleanup.service.js` ← `tests/coaching/feat106-soniox-cleanup.test.js`
- `speaker-roles.js` ← `bot/tests/observe/bd-ri5o9-debrief-speaker-roles.test.js` · `tests/coaching/bd-s192t-roles-threading.test.js`
- `student-ingress-cache.js` ← `bot/tests/first-touch/door-keys.test.js`
- `student-ingress-identity.js` ← `bot/tests/quiz/web-quiz/web-quiz-student-join-waves.test.js`
- `student-ingress.js` ← `bot/tests/first-touch/door-cache.test.js` · `bot/tests/first-touch/door-known.golden.test.js` · `bot/tests/first-touch/door-off.golden.test.js` · `bot/tests/first-touch/door-on.test.js` · `bot/tests/first-touch/one-door-child-word.test.js` · `bot/tests/quiz/student-ingress-after-remember.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/services/student-ingress.js`)
- `student-list.service.js` ← `bot/tests/services/student-list.test.js` · `tests/classes/class-service.test.js`
- `student-mode.service.js` ← `bot/tests/quiz/web-quiz/child-identity-store.test.js` · `tests/quiz/student-mode-decide.test.js`
- `student-video-feedback.service.js` ← `bot/tests/quiz/video-quiz-post-quiz-telemetry.test.js` · `bot/tests/student-video-feedback.test.js` · `tests/student-videos/student-videos-flow.test.js`
- `student-videos-entry.service.js` ← `bot/tests/first-touch/maker-fallback.test.js` · `tests/handlers/feature-doors.test.js`
- `teacher-state.service.js` ← `tests/conversation-state/cross-flow-safety.test.js` · `tests/status/status-flow.test.js` · `tests/status/status-internal-ids.test.js` · `tests/status/status-lp612-visibility.test.js` · `tests/status/status-task-count.test.js` · `tests/status/status-training-visibility.test.js`
- `toc-loading.service.js` ← `tests/textbook-lp-v2/toc-loading.test.js`
- `topic-matching.service.js` ← `bot/tests/handlers/lesson-plan-v2.handler.test.js` · `bot/tests/services/topic-matching.service.test.js` · `tests/textbook-lp-v2/topic-matching.test.js`
- `urdu-tts-normalizer.js` ← `tests/coaching/feat106-urdu-tts-normalizer.test.js` · `tests/coaching/urdu-tts-decimals.test.js`
- `vision.service.js` ← `bot/tests/handlers/image-message.handler.test.js` · `bot/tests/model-pilot-vision.test.js` · `bot/tests/services/vision.service.test.js` · `tests/coaching/bd-b3pop-vision-options.test.js` · `tests/llm/job-override-hardening.test.js` · `tests/llm/job-override-round2.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/vision.service.js`)
- `voice-attendance.service.js` ← `tests/attendance/cross-script-names.test.js` · `tests/attendance/student-flow-four-asks.test.js` · `tests/attendance/voice-roll-call.test.js` · `tests/attendance/voice-session-state.contract.test.js` · `tests/handlers/voice-note-temp-collision.test.js`
- `webhook-signature.js` ← `tests/whatsapp/webhook-signature.test.js`
- `whatsapp-send-pacer.js` ← `tests/assessment/assessment-rebuild-sync-budget.test.js` · `tests/whatsapp/password-reset-sync-budget.test.js` · `tests/whatsapp/send-pacing.redis.test.js` · `tests/whatsapp/send-pacing.test.js` · `tests/whatsapp/send-sync-budget.test.js`
- `whatsapp-sent-ids.js` ← `bot/tests/quiz/report-delivery-send.test.js`
- `whatsapp-status-pricing.js` ← `bot/tests/whatsapp-status-pricing.test.js`
- `whatsapp.service.js` ← `bot/scripts/e2e/lp-feedback-e2e.js` · `bot/tests/coaching/bd-v0toag-106-report-window-template.test.js` · `bot/tests/coaching/bd-v0toag-124-commit-prompt-template.test.js` · `bot/tests/coaching/bd-v0toag-127-template-error-detail.test.js` · `bot/tests/first-touch/first-reply-english.text-turn.test.js` · `bot/tests/first-touch/maker-empty.golden.test.js` (+317: `python3 kg/kg.py who-reads bot/shared/services/whatsapp.service.js`)
- `whisper-chunk-planner.js` ← `tests/coaching/feat106-whisper-chunking.test.js`

## Related (all, generated)
- skills: `ab-testing`? · `coaching`? · `cross-agent-safety`? · `debugging`? · `digital-coach`? · `gherkin-spec-sync`? · `reading-assessment`? · `registration`?
- docs: `AGENTS.md`? · `CLAUDE.md`? · `bot/README.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/LP_PATHS.md`? · `docs/agent-customization.md`? · `docs/app-funnel-telemetry.md`? · `docs/architecture.md`? · `docs/customization.md`? · `docs/e2e-cassette.md`? · `docs/e2e-mock-lane.md`? · `docs/features/homework.md`? · `docs/migration/DEPLOYMENT.md`? · `docs/model-switching.md`? · `docs/qa-automation.md`? · `docs/roadmap/audio-lp.md`? · `docs/student-mode.md`? · `infrastructure/templates/drafts/README.md`? · `infrastructure/templates/share/README.md`? · `tests/features/whatsapp/niete/_suite.md`?
