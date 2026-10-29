# tests — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `calls/` | → (no door; 30 files: 29 test + 1 support) |
| `child-test/` | Jest tests for the child test: draw, SA scorer, results dashboard, voice, stop rules → `child-test/CLAUDE.md` |
| `coaching/` | Jest suites for coaching: guards, report sending, language, subject resolution → `coaching/CLAUDE.md` |
| `first-touch/` | Tests for one door, quiz maker and teacher home, with recorded goldens → `first-touch/CLAUDE.md` |
| `fixtures/` | → (no door; 2 files: 0 test + 2 support) |
| `handlers/` | → (no door; 10 tests) |
| `helpers/` | Shared test doubles: Supabase table double and switch-off matrix → `helpers/CLAUDE.md` |
| `i18n/` | → (no door; 1 tests) |
| `lp-v8/` | Tests for lesson-plan delivery: v8/v9 corpus, Flow, uploader, LP chat context → `lp-v8/CLAUDE.md` |
| `menu/` | → (no door; 2 tests) |
| `nudges/` | → (no door; 6 tests) |
| `observe/` | Jest tests for the /observe stack: one file per incident or feature (bd-id in name) → `observe/CLAUDE.md` |
| `push/` | → (no door; 3 tests) |
| `quiz/` | Jest suites for the quiz stack: video/chat quiz, reports, student door, web quiz → `quiz/CLAUDE.md` |
| `registration/` | → (no door; 8 tests) |
| `routes/` | → (no door; 4 tests) |
| `sa-game/` | → (no door; 4 tests) |
| `services/` | → (no door; 35 tests) |
| `settings/` | → (no door; 2 tests) |
| `unit/` | → (no door; 10 tests) |
| `video/` | → (no door; 10 tests) |
| `welcome/` | → (no door; 2 tests) |
| `whatsapp/` | → (no door; 2 tests) |
| `workers/` | → (no door; 11 tests) |
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
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/CLAUDE.md`? · `bot/shared/services/video/CLAUDE.md`?
