# utils — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/utils -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 2 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `actor-context.js` | AsyncLocalStorage actor carried to Supabase via actorFetch so record_history stops attributing rows to 'authenticator' |
| `alphabet-grid-generator.js` | Draws the 3x4+2 alphabet grid image with canvas for reading assessment, avoiding vision prompt injection |
| `build-info.js` | commitSha helper exposed on /health so E2E runners can verify the build under test |
| `canvas-loader.js` | Graceful loader for native canvas and chartjs-node-canvas with availability checks |
| `child-reply-language.js` | Decides in code which language a child's reply should use per turn, rather than trusting the model |
| `constants.js` | Central env-derived constants: Flow IDs, VOICE_MODELS routing table, presence-gated feature IDs |
| `devanagari-guard.js` | Detects Devanagari in transcripts and transliterates back to Urdu script after misidentified-Hindi cases (bd-bfy69) |
| `first-reply-english-evidence.js` | Decides if a brand-new row's first message is plainly English so it may be answered in English, not Roman Urdu |
| `flow-type-detector.js` | Identifies which WhatsApp Flow an nfm_reply came from by its response_json fields, for whatsapp-bot routing |
| `greeting.js` | Detects a message that is only a greeting so a new user gets the registration invite instead of two replies |
| `html-to-docx.js` | Builds a real .docx (zip of XML via jszip) from rendered paper HTML for assessment downloads |
| `html-to-pdf.js` | Playwright/Chromium HTML to PDF/PNG renderer with lazy browser singleton and font loading |
| `json-tex-backslashes.js` | Repairs TeX backslashes inside model JSON replies; shared by lp612-author and class-quiz passes (bd-mg9c7.159.19) |
| `language-cache.js` | Redis-cached user language preference with Postgres fallback and setUserLanguage writer |
| `language-canon.js` | Canonicalises language values at store/compare boundaries so 'swahili'-style strings cannot reach the DB |
| `language-detection.js` | Detects an explicit language request and parses subject/grade from a message; never auto-detects from content |
| `language-detector.js` | Dominant-language calculation from Soniox token language ids and override detection for language updates |
| `lazy-client.js` | lazyClient helper building SDK clients on first use so a missing API key never crashes cold boot |
| `letter-name-mapping.js` | Maps letter symbols to spoken-name variants so reading assessment can match a child's "alif" to the letter |
| `logger.js` | Structured JSON logger (logToFile/logError/logWarn) for Railway/Axiom with auto correlationId |
| `lp-intent.js` | Detects a message that is just a lesson-plan menu request (lp, lesson plan, Urdu) before the LLM classifier |
| `merge-within-cap.js` | Merges adjacent message parts into one WhatsApp field when within the field cap, to halve billing |
| `model-cost.js` | Records actual model call cost from OpenRouter usage.cost; deliberately has no price table (bd-8t362) |
| `num-keep.js` | Replaces the space after a number with U+00A0 so Urdu share lines never wrap a number from its noun |
| `output-language-check.js` | Verifies generated text came back in the requested language by script letter counts |
| `person-name.js` | The one resolver for a person's full, first and display name from users.name (bd-60092) |
| `phone-validation.js` | Validates and normalises phone numbers to E.164, rejecting Meta-blocked country codes |
| `postgrest-paged.js` | Reads whole PostgREST result sets in windows, since db-max-rows truncates silently |
| `private-temp.js` | Collision-proof temp file paths for media sends so concurrent sends never share a name (bd-c00np) |
| `region.js` | Resolves deployment region from DEFAULT_REGION env and a user's region from users.region |
| `registration-intent.js` | Detects messages asking to register ("Register me", "/registered" typos) so they open the form |
| `registration-status.js` | One definition of isRegistered / needsRegistrationForm / needsSchoolForFeature from users columns |
| `resolve-response-language.js` | The one decision of which language a reply uses: stored preference vs script evidence |
| `roster-ack.js` | Builds the chat breadcrumb line sent after the /roster Flow closes, keyed by roster_action |
| `seeded-random.js` | Deterministic seeded RNG and shuffle so quiz question draws are reproducible without stored state |
| `setup-validator.js` | Synchronous boot-time check of env vars for Flow configuration; makes no API calls |
| `slash-command.js` | Canonicalises mistyped slash commands ("menu/", "/ menu") so command doors still match |
| `soft-delete.js` | One soft-delete convention: patch builders and liveOnly filters for retiring rows without destroying them |
| `sqs-visibility-heartbeat.js` | Periodically re-extends an SQS message visibility timeout for long jobs such as lp612_author (bd-awqt3) |
| `structured-logger.js` | Pino structured logger with Axiom HTTP ingest and console override; required at the top of entry points |
| `teacher-level.js` | The one reader of a teacher's level/band, resolving four disagreeing users columns |
| `tex-to-unicode.js` | Converts TeX maths to readable Unicode for WhatsApp message bodies (bd-lafr9) |
| `text-format.js` | Shared presentation helpers (emphasis, digit normalisation, class parsing) for class-report service and template |
| `tracing.js` | Lightweight span/trace helper withSpan for operation hierarchy and duration measurement |
| `tts-preprocessor.js` | Rewrites maths/science terms into speakable text before TTS for generated educational videos |
| `unsupported-message.js` | Chooses the reply for message types with no handler; stops reactions and videos reading as errors (bd-fbih0) |
| `validators.js` | Webhook guards: test webhook/number checks, 24-hour message age and duplicate-message detection |
| `version-check.js` | Checks the GitHub releases API for a newer rumi-platform version; never throws |
| `web-drain.js` | Graceful web shutdown that waits for in-flight webhook work, not just sockets |
| `word-grid-generator.js` | Generates 2-column word-grid images with canvas, using an LLM to pick age-appropriate words |

## Who reads this (all, generated)
- `actor-context.js` ← imported by `bot/shared/config/supabase.js:20:c22fb5fc` · `bot/shared/handlers/observe-visit-flow.handler.js:1313:d46368e9` · `bot/shared/routes/class-manager-endpoint.js:796:e8b751f9` · `bot/shared/routes/edit-class-endpoint.js:261:e8b751f9` (+2: `python3 kg/kg.py who-reads actor-context.js`)
- `alphabet-grid-generator.js` ← imported by `bot/shared/services/reading/passage-generation.service.js:27:f6a50008`
- `build-info.js` ← imported by `bot/whatsapp-bot.js:2780:84624a7e`
- `canvas-loader.js` ← imported by `bot/shared/services/reading/passage-generation.service.js:19:0c7a3bb1` · `bot/shared/utils/alphabet-grid-generator.js:15:8bc89b5c` · `bot/shared/utils/word-grid-generator.js:20:8bc89b5c`
- `child-reply-language.js` ← imported by `bot/shared/handlers/text-message.handler.js:4:aab35726`
- `constants.js` ← imported by `bot/shared/calls/graph-calls-api.js:16:cb402e79` · `bot/shared/handlers/remark-command.handler.js:153:3a36d33a` · `bot/shared/handlers/text-message.handler.js:42:dbb6ab33` · `bot/shared/handlers/voice-message.handler.js:20:9ab52fc1` (+41: `python3 kg/kg.py who-reads constants.js`)
- `devanagari-guard.js` ← imported by `bot/shared/services/audio.service.js:646:ccf3337f`
- `first-reply-english-evidence.js` ← imported by `bot/shared/handlers/text-message.handler.js:6:5ba513e3`
- `flow-type-detector.js` ← imported by `bot/whatsapp-bot.js:1707:5409f3d6`
- `greeting.js` ← imported by `bot/shared/handlers/text-message.handler.js:46:0198b716`
- `html-to-docx.js` ← imported by `bot/shared/services/assessment/assessment-format.js:40:0a218365`
- `html-to-pdf.js` ← imported by `bot/shared/routes/teacher-report-internal.routes.js:221:48ea689c` · `bot/shared/services/assessment/assessment-format.js:47:5f90cdf4` · `bot/shared/services/child-test/render/index.js:11:438eb0f8` · `bot/shared/services/child-test/render/v2.js:810:6a882600` (+21: `python3 kg/kg.py who-reads html-to-pdf.js`)
- `json-tex-backslashes.js` ← imported by `bot/shared/services/lp612-author.service.js:147:96e7f29b` · `bot/shared/services/quiz/transcript-quiz-llm.js:21:6aa16317`
- `language-cache.js` ← imported by `bot/shared/database/bot-helpers.js:272:9cfbe857` · `bot/shared/handlers/flow-response.handler.js:55:1e5da0b0` · `bot/shared/handlers/image-message.handler.js:27:9cfbe857` · `bot/shared/handlers/roster-command.js:20:9cfbe857` (+21: `python3 kg/kg.py who-reads language-cache.js`)
- `language-canon.js` ← imported by `bot/shared/database/bot-helpers.js:257:5605b349` · `bot/shared/utils/language-cache.js:20:cb5880b6`
- `language-detection.js` ← imported by `bot/shared/handlers/text-message.handler.js:70:dedee3d4` · `bot/shared/handlers/voice-message.handler.js:38:77508d07`
- `language-detector.js` ← imported by `bot/shared/handlers/text-message.handler.js:67:d7dd6af3` · `bot/shared/handlers/voice-message.handler.js:1047:d7dd6af3` · `bot/shared/services/coaching/transcription-processor.service.js:25:c4974a5b`
- `lazy-client.js` ← imported by `bot/shared/services/aws-textract.service.js:3:cefd900d` · `bot/shared/services/coaching/reflective-questions/llm-router.service.js:45:ce0c2ed9` · `bot/shared/services/coaching/transcript-enhancer.service.js:19:0f3248c3` · `bot/shared/storage/r2.js:10:cefd900d`
- `letter-name-mapping.js` ← imported by `bot/shared/services/reading/fluency.service.js:26:8cdbddc5`
- `logger.js` ← imported by `bot/shared/calls/call-forwarder.js:18:9949d551` · `bot/shared/calls/call-log.service.js:19:9949d551` · `bot/shared/config/feature-flags.js:13:9949d551` · `bot/shared/config/model-settings.js:21:9949d551` (+593: `python3 kg/kg.py who-reads logger.js`)
- `lp-intent.js` ← imported by `bot/shared/handlers/text-message.handler.js:48:ac1a2b1e`
- `merge-within-cap.js` ← imported by `bot/shared/services/nudges/lp-quiz-offer.service.js:56:22be3b58` · `bot/shared/services/observe/observe-debrief.service.js:28:22be3b58` · `bot/shared/services/observe/observe-send.service.js:26:22be3b58`
- `model-cost.js` ← imported by `bot/shared/services/llm-client.js:39:6fa1282d`
- `num-keep.js` ← imported by `bot/shared/services/quiz/web-quiz-card-data.js:222:5a1ff086` · `bot/shared/templates/web-quiz-art.template.js:34:62532c57`
- `output-language-check.js` ← imported by `bot/shared/handlers/text-message.handler.js:3:49664e60` · `bot/shared/handlers/voice-message.handler.js:8:49664e60`
- `person-name.js` ← imported by `bot/shared/handlers/text-message.handler.js:2:c77c4184` · `bot/shared/handlers/voice-message.handler.js:1:c77c4184` · `bot/workers/stale-session.worker.js:25:f35d109c` · `dashboard/routes/coaching-report.routes.js:29:cb2af6f0` (+3: `python3 kg/kg.py who-reads person-name.js`)
- `postgrest-paged.js` ← imported by `bot/scripts/export-lp612-segments.js:40:13a72ceb` · `bot/shared/routes/pakistan-lp-endpoint.js:42:180a3197` · `bot/shared/services/coaching/weekly-report/reader.js:20:95f83ee9` · `bot/shared/services/lp-v8-delivery.service.js:17:180a3197` (+3: `python3 kg/kg.py who-reads postgrest-paged.js`)
- `private-temp.js` ← imported by `bot/shared/handlers/voice-message.handler.js:24:18ed7c80` · `bot/shared/services/audio.service.js:22:18ed7c80` · `bot/shared/services/coaching/portal-coaching.service.js:563:43fd1c80` · `bot/shared/services/whatsapp.service.js:8:18ed7c80`
- `region.js` ← imported by `bot/shared/handlers/observe-command.handler.js:19:342576fb` · `bot/shared/handlers/text-message.handler.js:36:57d17696` · `bot/shared/services/child-test/conversation/gate.js:18:d16ee7ff` · `bot/shared/services/observe/observe-debrief.service.js:26:5883247a`
- `registration-intent.js` ← imported by `bot/shared/handlers/text-message.handler.js:45:362c5444`
- `registration-status.js` ← imported by `bot/shared/handlers/portal-command.handler.js:19:07ec5d3a` · `bot/shared/handlers/text-message.handler.js:44:8923ab8e` · `bot/shared/services/app-redirect.service.js:87:07ec5d3a` · `bot/shared/services/feature-registration.service.js:25:385791df` (+4: `python3 kg/kg.py who-reads registration-status.js`)
- `resolve-response-language.js` ← imported by `bot/shared/handlers/text-message.handler.js:5:a0bf956b` · `bot/shared/handlers/voice-message.handler.js:9:a0bf956b`
- `roster-ack.js` ← imported by `bot/whatsapp-bot.js:1803:5b390c5e`
- `seeded-random.js` ← imported by `bot/shared/services/training/isaps-crq-paper.rules.js:28:1f8848ff` · `bot/shared/services/training/quiz-serving.service.js:52:cdef7bf3`
- `setup-validator.js` ← imported by `bot/whatsapp-bot.js:2945:6cad87bc`
- `slash-command.js` ← imported by `bot/shared/handlers/text-message.handler.js:7:aa8017b8`
- `soft-delete.js` ← imported by `bot/shared/services/observe/teacher-edit.service.js:26:3efec63f`
- `sqs-visibility-heartbeat.js` ← imported by `bot/workers/sqs-worker.js:44:fdfe945a`
- `structured-logger.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:14:6565d9d3` · `bot/shared/handlers/image-message.handler.js:26:b00ce36f` · `bot/shared/routes/child-test-check-endpoint.js:32:fada67b3` · `bot/shared/routes/class-round-internal.routes.js:23:fada67b3` (+173: `python3 kg/kg.py who-reads structured-logger.js`)
- `teacher-level.js` ← imported by `bot/shared/services/coaching/video-reco/store.js:10:d194bab8` · `bot/shared/services/observe/teacher-edit-commit.service.js:37:4cf81746` · `bot/shared/services/observe/teacher-edit.service.js:25:c26b0b0e`
- `tex-to-unicode.js` ← imported by `bot/shared/services/lp612-serving.service.js:36:124d4709` · `bot/shared/services/quiz/quiz-math.js:37:9e842b49`
- `text-format.js` ← imported by `bot/shared/routes/transcript-quiz-flow-endpoint.js:46:8dd1209b` · `bot/shared/services/openai.service.js:9:4c357e6e` · `bot/shared/services/quiz/video-quiz-report.service.js:29:b6cab053` · `bot/shared/services/quiz/web-quiz.service.js:30:68e47b0a` (+1: `python3 kg/kg.py who-reads text-format.js`)
- `tts-preprocessor.js` ← imported by `bot/shared/services/video/video-script.service.js:8:fed97c92`
- `unsupported-message.js` ← imported by `bot/whatsapp-bot.js:2430:ce1f72e8`
- `validators.js` ← imported by `bot/shared/services/whatsapp-status-pricing.js:12:da81880a` · `bot/whatsapp-bot.js:58:d625b49d`
- `version-check.js` ← imported by `bot/whatsapp-bot.js:2955:7e4b5ef2`
- `web-drain.js` ← imported by `bot/whatsapp-bot.js:6:5183c38a`
- `word-grid-generator.js` ← imported by `bot/shared/services/reading/passage-generation.service.js:28:ab676e5c`
- column `users.language_locked` (written by `language-cache.js`) ← read by `bot/shared/routes/registration-endpoint.js:104:713d0c02` · `dashboard/routes/portal.routes.js:8817:6505fa79` · `scripts/language-floor-flip.js:314:1ecb6fd7`
- column `users.preferred_language` (written by `language-cache.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/handlers/flow-response.handler.js:761:6d7fc8d6` · `bot/shared/routes/assessment-gen-endpoint.js:995:578cc074` · `bot/shared/routes/class-manager-endpoint.js:143:aa90cbd2` (+70: `python3 kg/kg.py who-reads users.preferred_language`)
- table `users` whole row (`*`) (written by `language-cache.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:313:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `users` (written by `language-cache.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+168: `python3 kg/kg.py who-reads users`)
- env `ASSESSMENT_GEN_FLOW_ID` read at `bot/shared/utils/constants.js:75:751abbfb`
- env `ASSESSMENT_REVIEW_FLOW_ID` read at `bot/shared/utils/constants.js:80:e2729069`
- env `ATTENDANCE_MARKING_FLOW_ID` read at `bot/shared/utils/constants.js:23:e080b7be`
- env `ATTENDANCE_SETUP_FLOW_ID` read at `bot/shared/utils/constants.js:22:84baca7c`
- env `AXIOM_DATASET` read at `bot/shared/utils/structured-logger.js:41:5bf82b5f`
- env `AXIOM_TOKEN` read at `bot/shared/utils/structured-logger.js:42:2c93238a`
- env `CLASS_MANAGER_FLOW_ID` read at `bot/shared/utils/constants.js:50:16504dbc`
- env `COACHING_WHATSAPP_NUMBER` read at `bot/shared/utils/constants.js:84:407dffe7`
- env `DEFAULT_PHONE_COUNTRY_CODE` read at `bot/shared/utils/phone-validation.js:33:92bbd975`
- env `DEFAULT_REGION` read at `bot/shared/utils/region.js:15:93579612`
- env `EDIT_CLASS_FLOW_ID` read at `bot/shared/utils/constants.js:47:2fdc82e1`
- env `ELEVENLABS_API_KEY` read at `bot/shared/utils/constants.js:9:a931f25a`
- env `ELEVENLABS_VOICE_ID` read at `bot/shared/utils/constants.js:131:b42a941c`
- env `ELEVENLABS_VOICE_ID_AR` read at `bot/shared/utils/constants.js:133:73bcc96b`
- env `ELEVENLABS_VOICE_ID_ES` read at `bot/shared/utils/constants.js:132:8b1895af`
- env `ELEVENLABS_VOICE_ID_UR` read at `bot/shared/utils/constants.js:138:dc386e89`
- env `EXAM_CHECKER_STUDENTS_FLOW_ID` read at `bot/shared/utils/setup-validator.js:55:13a6d1cb`
- env `FLOW_PRIVATE_KEY` read at `bot/shared/utils/setup-validator.js:35:361dad14`
- env `FLOW_PRIVATE_KEY_B64` read at `bot/shared/utils/setup-validator.js:35:361dad14`
- env `GAMMA_API_KEY` read at `bot/shared/utils/constants.js:11:a931dea8`
- env `HOMEWORK_FLOW_ID` read at `bot/shared/utils/constants.js:44:dbf221a0` · `bot/shared/utils/setup-validator.js:52:69f4c313`
- env `INTERNAL_API_KEY` read at `bot/shared/utils/setup-validator.js:70:e48d2058`
- env `KIE_API_KEY` read at `bot/shared/utils/constants.js:55:afc63570`
- env `LISTENING_ANIMATION_MEDIA_ID` read at `bot/shared/utils/constants.js:15:a89aa0a1`
- env `LOADING_STICKER_MEDIA_ID` read at `bot/shared/utils/constants.js:13:0f6c40a8`
- env `LOG_LEVEL` read at `bot/shared/utils/structured-logger.js:282:1b37539c`
- env `MENU_IMAGE_MEDIA_ID` read at `bot/shared/utils/constants.js:17:56e221e5`
- env `MMS_API_KEY` read at `bot/shared/utils/constants.js:122:046972d3`
- env `MMS_SERVICE_URL` read at `bot/shared/utils/constants.js:120:9080c308` · `bot/shared/utils/setup-validator.js:80:0e8d70d9`
- env `MMS_TIMEOUT_MS` read at `bot/shared/utils/constants.js:121:d93a3a6a`
- env `NODE_ENV` read at `bot/shared/utils/setup-validator.js:79:d8e24952` · `bot/shared/utils/structured-logger.js:23:f5fe5763`
- env `OPENAI_API_KEY` read at `bot/shared/utils/constants.js:12:d7d391c6`
- env `PAKISTAN_LP_FLOW_ID` read at `bot/shared/utils/constants.js:81:7256bc2b`
- env `PEDAGOGICAL_ANALYSIS_MEDIA_ID` read at `bot/shared/utils/constants.js:16:5abbd29a`
- env `PHONE_NUMBER_ID` read at `bot/shared/utils/constants.js:6:c79e4792` · `bot/shared/utils/validators.js:100:4e41fbbf`
- env `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` read at `bot/shared/utils/html-to-pdf.js:43:9c959316`
- env `PORT` read at `bot/shared/utils/constants.js:19:75261947`
- env `PUPPETEER_EXECUTABLE_PATH` read at `bot/shared/utils/html-to-pdf.js:44:dd69a95a`
- env `QUIZ_FLOW_ID` read at `bot/shared/utils/constants.js:63:2441e085` · `bot/shared/utils/setup-validator.js:54:40c1f4f9`
- env `RAILWAY_ENVIRONMENT` read at `bot/shared/utils/structured-logger.js:23:f5fe5763`
- env `RAILWAY_SERVICE_NAME` read at `bot/shared/utils/structured-logger.js:295:2303aca6`
- env `RATE_LIMIT_MAX` read at `bot/shared/utils/constants.js:168:083e53e6`
- env `RATE_LIMIT_WINDOW_SECONDS` read at `bot/shared/utils/constants.js:169:14f7848e`
- env `READING_ASSESSMENT_FLOW_ID` read at `bot/shared/utils/setup-validator.js:30:c98d40c5`
- env `REGION` read at `bot/shared/utils/structured-logger.js:297:59e1f37d`
- env `REGISTRATION_SUCCESS_STICKER_MEDIA_ID` read at `bot/shared/utils/constants.js:14:daad8d6c`
- env `REGISTRATION_VIDEO_MEDIA_ID` read at `bot/shared/utils/constants.js:97:976255f2`
- env `REMARK_FLOW_ID` read at `bot/shared/utils/constants.js:28:3ad76978`
- env `ROSTER_FLOW_ID` read at `bot/shared/utils/constants.js:52:bfb265b1`
- env `RUMI_LOGO_R2_KEY` read at `bot/shared/utils/constants.js:61:2cc3b4c5`
- env `SERVICE_NAME` read at `bot/shared/utils/structured-logger.js:295:2303aca6`
- env `SETTINGS_FLOW_ID` read at `bot/shared/utils/constants.js:25:34dda61d` · `bot/shared/utils/setup-validator.js:50:954bcf3f`
- env `SONIOX_API_KEY` read at `bot/shared/utils/constants.js:8:6a29fde5`
- env `SONIOX_BACKUP_MODEL` read at `bot/shared/utils/constants.js:112:79a96ebc`
- env `SONIOX_PRIMARY_MODEL` read at `bot/shared/utils/constants.js:111:567ee375`
- env `STATUS_FLOW_ID` read at `bot/shared/utils/constants.js:31:66cea4be` · `bot/shared/utils/setup-validator.js:51:37076600`
- env `STUDENT_QUIZ_FLOW_ID` read at `bot/shared/utils/constants.js:41:31a1906c`
- env `STUDENT_VIDEOS_FLOW_ID` read at `bot/shared/utils/constants.js:34:c4b23c5c` · `bot/shared/utils/setup-validator.js:53:2cd5e58e`
- env `TEACHER_TRAINING_FLOW_ID` read at `bot/shared/utils/constants.js:65:2fb83044`
- env `TRAINING_MSQ_FLOW_ID` read at `bot/shared/utils/constants.js:69:2b921b47`
- env `TRANSCRIPT_QUIZ_FLOW_ID` read at `bot/shared/utils/constants.js:38:3815cadf`
- env `UPLIFT_API_KEY` read at `bot/shared/utils/constants.js:10:f6869902`
- env `UPLIFT_VOICE_ID_BAL` read at `bot/shared/utils/constants.js:128:2101e7e3`
- env `UPLIFT_VOICE_ID_SD` read at `bot/shared/utils/constants.js:127:95c6bcde`
- env `UPLIFT_VOICE_ID_UR` read at `bot/shared/utils/constants.js:126:28f612ae`
- env `WABA_ID` read at `bot/shared/utils/constants.js:18:601afc5a`
- env `WEBHOOK_VERIFY_TOKEN` read at `bot/shared/utils/constants.js:7:e44131aa`
- env `WHATSAPP_TOKEN` read at `bot/shared/utils/constants.js:5:60bafac2`

## Tests (all, generated)
- `actor-context.js` ← `tests/database/bd-a21ks-actor-ledger.test.js` · `tests/database/bd-rbtpr-ledger-gaps.test.js` · `tests/roster/roster-class-details.test.js`
- `build-info.js` ← `tests/e2e-mock/build-info.test.js`
- `child-reply-language.js` ← `tests/language/child-reply-language.test.js`
- `constants.js` ← `bot/tests/lp-v8/history-cache-hygiene.test.js` · `bot/tests/lp-v8/sara-voice-delta.test.js` · `bot/tests/services/bd-2kxxa3-whisper-extension-convert.test.js` · `tests/attendance/register-delivery-temp-race.test.js` · `tests/coaching/feat106-soniox-models.test.js` · `tests/handlers/audio-service-temp-collision.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/utils/constants.js`)
- `devanagari-guard.js` ← `tests/coaching/devanagari-guard.test.js`
- `first-reply-english-evidence.js` ← `bot/tests/first-touch/first-reply-english-evidence.test.js`
- `flow-type-detector.js` ← `bot/tests/observe/visit-flow-wiring.test.js` · `bot/tests/observe/visit-scheduling-wiring.test.js` · `bot/tests/quiz/student-quiz-flow-endpoint.test.js` · `tests/assessment/assessment-chat-ack.test.js` · `tests/attendance/completion-classified-from-token.test.js` · `tests/attendance/marking-completion.test.js` (+14: `python3 kg/kg.py who-reads bot/shared/utils/flow-type-detector.js`)
- `greeting.js` ← `tests/registration/greeting-only.test.js`
- `html-to-docx.js` ← `tests/assessment/assessment-format.test.js`
- `html-to-pdf.js` ← `bot/tests/coaching/latin-runs-coaching-print.test.js` · `bot/tests/observe/bd-2406-2407-urdu-font-render.test.js` · `bot/tests/quiz/chat-quiz-report-send-checked.test.js` · `bot/tests/quiz/class-report-layout.test.js` · `bot/tests/quiz/latin-runs-rtl.test.js` · `bot/tests/quiz/lp-quiz-report.test.js` (+43: `python3 kg/kg.py who-reads bot/shared/utils/html-to-pdf.js`)
- `language-cache.js` ← `bot/tests/first-touch/first-reply-english.text-turn.test.js` · `tests/cache/language-writer.test.js` · `tests/language/resolver-floors.test.js` · `tests/registration/bd-x7aprz2-registration-v5.test.js`
- `language-canon.js` ← `tests/config/language-canon.test.js`
- `language-detector.js` ← `tests/coaching/bd2413-output-language.test.js`
- `logger.js` ← `bot/scripts/e2e/dns-pin.js` · `bot/tests/child-test/sa-score-timeouts.test.js` · `bot/tests/first-touch/maker-fallback.test.js` · `bot/tests/first-touch/maker.routes.test.js` · `bot/tests/first-touch/mount-failed.test.js` · `bot/tests/first-touch/teacher-home.quick.test.js` (+147: `python3 kg/kg.py who-reads bot/shared/utils/logger.js`)
- `lp-intent.js` ← `bot/tests/first-touch/maker.cards.test.js` · `bot/tests/handlers/template-button-fallthrough.test.js` · `bot/tests/lp-v8/lp-intent.test.js`
- `model-cost.js` ← `tests/llm/cost-user-attribution.test.js` · `tests/lp612/cost-names-the-lesson.test.js`
- `output-language-check.js` ← `tests/config/output-language-check.test.js`
- `person-name.js` ← `tests/users/bd-60092-one-name-column.test.js`
- `postgrest-paged.js` ← `tests/lp612/postgrest-paged.test.js`
- `region.js` ← `bot/tests/observe/observe-command.handler.test.js` · `tests/region/region-features.test.js`
- `registration-intent.js` ← `tests/registration/registration-intent.test.js`
- `registration-status.js` ← `bot/tests/registration/bd-2480-register-gate.test.js` · `tests/registration/needs-registration-form.test.js`
- `resolve-response-language.js` ← `tests/language/resolve-response-language.test.js`
- `roster-ack.js` ← `tests/roster/roster-ack-text.test.js`
- `setup-validator.js` ← `tests/setup/security.test.js`
- `slash-command.js` ← `tests/handlers/slash-command-similarity.test.js`
- `soft-delete.js` ← `tests/database/soft-delete.test.js`
- `sqs-visibility-heartbeat.js` ← `tests/lp612/sqs-visibility-heartbeat.test.js`
- `structured-logger.js` ← `bot/tests/coaching/bd-v0toag-127-template-error-detail.test.js` · `bot/tests/first-touch/door-bound-seam.test.js` · `bot/tests/first-touch/door-on.test.js` · `bot/tests/first-touch/maker-empty.golden.test.js` · `bot/tests/first-touch/maker.cards.test.js` · `bot/tests/first-touch/maker.cta-seam.test.js` (+259: `python3 kg/kg.py who-reads bot/shared/utils/structured-logger.js`)
- `teacher-level.js` ← `tests/users/teacher-level.test.js`
- `tex-to-unicode.js` ← `tests/lp612/tex-mixed-number.test.js`
- `text-format.js` ← `bot/tests/quiz/transcript-quiz-flow-endpoint.test.js` · `bot/tests/quiz/video-quiz-report-guidance-clean.test.js` · `bot/tests/quiz/video-quiz-report-template.test.js` · `tests/quiz/report-class-labels.test.js` · `tests/quiz/report-labels-and-guidance-box.test.js`
- `tracing.js` ← `bot/tests/unit/tracing.test.js`
- `unsupported-message.js` ← `bot/tests/calls/call-followups.test.js` · `bot/tests/lp-v8/unsupported-message.test.js` · `bot/tests/observe/bd-fbih0-unsupported-types.test.js` · `bot/tests/welcome/bd-oak77.13-request-welcome.test.js`
- `validators.js` ← `bot/tests/whatsapp-status-pricing.test.js` · `bot/tests/whatsapp/phoneless-inbound.test.js` · `tests/e2e-mock/simulate-builders.test.js` · `tests/whatsapp/webhook-signature.test.js`
- `version-check.js` ← `tests/setup/version-check.test.js`
- `web-drain.js` ← `tests/assessment/revision-ack-without-text.test.js` · `tests/attendance/completion-classified-from-token.test.js` · `tests/broadcast/bd-07cjd-hos-video-buttons.test.js` · `tests/child-test/L6/webhook-completion.test.js` · `tests/coaching/audio-document-oversize.test.js` · `tests/lesson-plan-lifecycle/oxbridge-picker-webhook.test.js` (+9: `python3 kg/kg.py who-reads bot/shared/utils/web-drain.js`)

## Related (all, generated)
- skills: `coaching`? · `debugging`? · `logging`? · `whatsapp-flows`?
- docs: `.claude/skills/niete-mock-e2e/reference/exit-codes.md`? · `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/scripts/e2e/CLAUDE.index.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/calls/CLAUDE.index.md`? · `bot/tests/calls/CLAUDE.md`? · `bot/tests/child-test/CLAUDE.index.md`? · `bot/tests/coaching/CLAUDE.index.md`? · `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/handlers/CLAUDE.index.md`? · `bot/tests/handlers/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/registration/CLAUDE.md`? · `bot/tests/services/CLAUDE.index.md`? · `bot/tests/unit/CLAUDE.md`? · `bot/tests/welcome/CLAUDE.md`? · `bot/tests/whatsapp/CLAUDE.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/CLAUDE.index.md`? · `docs/agent-customization.md`? · `docs/app-funnel-telemetry.md`? · `docs/customization.md`? · `docs/e2e-mock-lane.md`? · `docs/quiz-telemetry.md`? · `tests/assessment/CLAUDE.index.md`? · `tests/attendance/CLAUDE.index.md`? · `tests/broadcast/CLAUDE.md`? · `tests/cache/CLAUDE.md`? · `tests/child-test/L6/CLAUDE.index.md`? · `tests/child-test/L6/CLAUDE.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/config/CLAUDE.index.md`? · `tests/config/CLAUDE.md`? · `tests/database/CLAUDE.index.md`? · `tests/database/CLAUDE.md`? · `tests/e2e-mock/CLAUDE.index.md`? · `tests/handlers/CLAUDE.index.md`? · `tests/language/CLAUDE.md`? · `tests/lesson-plan-lifecycle/CLAUDE.index.md`? · `tests/llm/CLAUDE.index.md`? · `tests/lp612/CLAUDE.index.md`? · `tests/quiz/CLAUDE.index.md`? · `tests/region/CLAUDE.md`? · `tests/registration/CLAUDE.index.md`? · `tests/roster/CLAUDE.index.md`? · `tests/roster/CLAUDE.md`? · `tests/setup/CLAUDE.index.md`? · `tests/users/CLAUDE.md`? · `tests/whatsapp/CLAUDE.index.md`? · `tests/whatsapp/CLAUDE.md`?
