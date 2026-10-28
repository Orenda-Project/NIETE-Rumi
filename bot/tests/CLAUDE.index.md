# tests — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `calls/` | Tests for the live WhatsApp voice-call stack (engine, session, prompt, tools) → `calls/CLAUDE.md` |
| `child-test/` | Jest tests for the child test: draw, SA scorer, results dashboard, voice, stop rules → `child-test/CLAUDE.md` |
| `coaching/` | Jest suites for coaching: guards, report sending, language, subject resolution → `coaching/CLAUDE.md` |
| `first-touch/` | Tests for one door, quiz maker and teacher home, with recorded goldens → `first-touch/CLAUDE.md` |
| `fixtures/` | → (no door; 2 test files) |
| `handlers/` | Tests for message-handler entry points: portal, video, slash and button routes → `handlers/CLAUDE.md` |
| `helpers/` | Shared test doubles: Supabase table double and switch-off matrix → `helpers/CLAUDE.md` |
| `i18n/` | Tests that Urdu/RTL strings keep slash commands readable → `i18n/CLAUDE.md` |
| `lp-v8/` | Tests for lesson-plan delivery: v8/v9 corpus, Flow, uploader, LP chat context → `lp-v8/CLAUDE.md` |
| `menu/` | Regression tests for /menu button handling (reading, lesson planning) → `menu/CLAUDE.md` |
| `nudges/` | Tests for scheduled teacher nudges: store, sweeper, PKT time, worker wiring → `nudges/CLAUDE.md` |
| `observe/` | Jest tests for the /observe stack: one file per incident or feature (bd-id in name) → `observe/CLAUDE.md` |
| `push/` | Tests for the web-quiz reminder push (switches, routes, service) → `push/CLAUDE.md` |
| `quiz/` | Jest suites for the quiz stack: video/chat quiz, reports, student door, web quiz → `quiz/CLAUDE.md` |
| `registration/` | Tests for registration Flow, /register and persistence of name and role → `registration/CLAUDE.md` |
| `routes/` | Tests for Flow endpoints and training unlock routes → `routes/CLAUDE.md` |
| `sa-game/` | Jest tests for the SA game switch, door, page route and run sink → `sa-game/CLAUDE.md` |
| `services/` | Tests for services: /remark (STEPS S), transcription, LP matching, vision → `services/CLAUDE.md` |
| `settings/` | Tests for the app_settings switch cache and outage behaviour → `settings/CLAUDE.md` |
| `unit/` | Small unit tests: logging, tracing, syntax guard, cassette, report styling → `unit/CLAUDE.md` |
| `video/` | Legacy tests for the AI video generation flow (style, language, PDF, R2) → `video/CLAUDE.md` |
| `welcome/` | Tests for the first-open welcome and WABA ice-breaker chips → `welcome/CLAUDE.md` |
| `whatsapp/` | Tests for the WhatsApp transport: username senders and audio sending → `whatsapp/CLAUDE.md` |
| `workers/` | Tests that drive the real SQS worker: queues, sweeps, visibility, boot lines → `workers/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bug-003-false-promise.test.js` | Pins that 'Mathematics for grade 2' style messages classify as lesson_plan intent, not general (BUG-003 false promise) |
| `bug-005-audio-document.test.js` | Pins that an audio document under 15 minutes is not treated as classroom audio and gets a clear reply (BUG-005) |
| `bug-014-video-language.test.js` | Pins that video script prompts give Punjabi explicit vocabulary guidance so narration is not Urdu (BUG-014) |
| `llm-cost-attributed.test.js` | Pins that model spend records carry the job name that spent it, never sent to the vendor as a field (bd-9b58p) |
| `llm-cost-queryable.test.js` | Pins that cost fields survive into Axiom columns as numbers so sum() works and unpriced calls stay null (bd-9b58p) |
| `llm-cost-recorded.test.js` | Pins that the shared model client records the vendor-reported cost of every call without changing the request (bd-8t362) |
| `llm-fallback-armed.test.js` | Pins that every getClientForModel caller names its job so the vendor fallback ladder is armed (bd-b8k7h) |
| `llm-fallback-per-job.test.js` | Pins per-job fallback: each job freezes the vendor model it already uses, no blanket gpt-4o fallback (bd-4uw7n) |
| `llm-vendor-fallback.test.js` | Pins the OpenAI-behind-other-vendors fallback: used when account cannot spend or supplier is down (bd-4uw7n) |
| `model-assessment-registry.test.js` | Pins the assessment-generation model registry entry: env defaults, English and Urdu overrides independent (bd-jntcx) |
| `model-pilot-vision.test.js` | Pins the vision.analyse model pilot through the registry: default gpt-4.1-mini, VISION_MODEL honoured (bd-5rd2f) |
| `model-registry-noop.test.js` | Safety test that the model registry changes no job's model: every job resolves to today's model and env var (bd-isn68) |
| `model-settings-backoff.test.js` | Pins model-settings back-off: a failing app_settings read is retried on a timer, not on every request (bd-dsr9l) |
| `model-settings-no-db.test.js` | Pins that loading the model-settings reader without Supabase env does not exit the process (bd-5rd2f) |
| `model-settings.test.js` | Tests model-settings reader: kill switch, JSON-string values and synchronous last-good-config accessor (bd-5rd2f) |
| `setup-loopback.js` | Jest setupFile that loopbacks service endpoints, dummies credentials and blocks live DB/Redis/LLM/WhatsApp in tests |
| `setup-loopback.test.js` | Tests jest never reaches a live service: loopback works, jest.config loads guard, ALLOW_LIVE_SERVICES_IN_TESTS opt-out |
| `setup.js` | Jest global setup: configures test environment, global mocks and test utilities before tests run |
| `student-video-feedback.test.js` | Tests StudentVideoFeedbackService thumbs-up/down button handling, snapshot insert and reason flag (bd-1598) |
| `video-reco-status-webhook.test.js` | Pins clip message delivered/read/failed statuses reach video_reco_events through the real status webhook (bd-gzfdu9) |
| `whatsapp-status-pricing.test.js` | Pins pricedFields and the whatsapp.status.priced event per delivered/read status keyed by users.id (bd-v0toag.65) |

## Who reads this (all, generated)
- env `ASSESSMENT_GEN_MODEL` read at `bot/tests/model-registry-noop.test.js:31:6a60a14f`
- env `ASSESSMENT_GEN_MODEL_FDE` read at `bot/tests/model-registry-noop.test.js:33:d9b2bed9`
- env `HCP_FEEDBACK_MODEL` read at `bot/tests/model-registry-noop.test.js:34:ce48f9dc`
- env `LLM_MODEL` read at `bot/tests/model-registry-noop.test.js:34:ce48f9dc`
- env `LP_AUTHOR_MODEL` read at `bot/tests/model-registry-noop.test.js:19:9ea07cad`
- env `LP_EXTRACTION_VISION_MODEL` read at `bot/tests/model-registry-noop.test.js:21:9b1aa4d6`
- env `LP_FIDELITY_MODEL` read at `bot/tests/model-registry-noop.test.js:20:37088cd0`
- env `OPENAI_API_KEY` read at `bot/tests/video-reco-status-webhook.test.js:9:334ba0e9`
- env `OPENROUTER_API_KEY` read at `bot/tests/video-reco-status-webhook.test.js:10:6d424b49`
- env `ROSTER_VISION_MODEL` read at `bot/tests/model-registry-noop.test.js:23:1d162776`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `bot/tests/video-reco-status-webhook.test.js:8:cd796d8a`
- env `SUPABASE_URL` read at `bot/tests/video-reco-status-webhook.test.js:7:d1ac37ba`
- env `TRANSCRIPT_QUIZ_MODEL` read at `bot/tests/llm-fallback-per-job.test.js:50:e24c5ace` · `bot/tests/model-registry-noop.test.js:24:7a4d6e5e`
- env `TRANSCRIPT_QUIZ_VERIFY_MODEL` read at `bot/tests/model-registry-noop.test.js:26:179593f5`
- env `VISION_MODEL` read at `bot/tests/model-registry-noop.test.js:22:ab8dd0e0`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/calls/CLAUDE.index.md`? · `bot/tests/calls/CLAUDE.md`? · `bot/tests/child-test/CLAUDE.index.md`? · `bot/tests/child-test/CLAUDE.md`? · `bot/tests/coaching/CLAUDE.index.md`? · `bot/tests/coaching/CLAUDE.md`? · `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/first-touch/CLAUDE.md`? · `bot/tests/handlers/CLAUDE.index.md`? · `bot/tests/handlers/CLAUDE.md`? · `bot/tests/helpers/CLAUDE.index.md`? · `bot/tests/helpers/CLAUDE.md`? · `bot/tests/i18n/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/lp-v8/CLAUDE.md`? · `bot/tests/menu/CLAUDE.md`? · `bot/tests/nudges/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/observe/CLAUDE.md`? · `bot/tests/push/CLAUDE.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.md`? · `bot/tests/registration/CLAUDE.md`? · `bot/tests/routes/CLAUDE.md`? · `bot/tests/sa-game/CLAUDE.md`? · `bot/tests/services/CLAUDE.index.md`? · `bot/tests/services/CLAUDE.md`? · `bot/tests/settings/CLAUDE.md`? · `bot/tests/unit/CLAUDE.md`? · `bot/tests/video/CLAUDE.md`? · `bot/tests/welcome/CLAUDE.md`? · `bot/tests/whatsapp/CLAUDE.md`? · `bot/tests/workers/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.md`?
