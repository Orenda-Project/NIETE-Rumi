# tests — Jest suite for the NIETE bot: unit, handler, worker, LP and call tests
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests kg=1adbd4724a79 gen=fc10b5025912 overflow=3 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `setup-loopback.js` — jest setupFile blocking live DB/Redis/LLM/WhatsApp in every test
- `helpers/table-double.js` — in-memory Supabase double; reuse instead of hand-rolled mocks
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 23 sub-dirs, each with `CLAUDE.md` | `calls/` · `child-test/` · `coaching/` · `first-touch/` · `handlers/` · `helpers/` · `i18n/` · `lp-v8/` · `menu/` · `nudges/` · `observe/` · `push/` · `quiz/` · `registration/` · `routes/` · `sa-game/` · `services/` · `settings/` · `unit/` · `video/` · `welcome/` · `whatsapp/` · `workers/` |
| 1 sub-dirs without a door | `fixtures/` (2 tests) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `student-video-feedback.test.js` | Tests StudentVideoFeedbackService thumbs-up/down button handling, snapshot insert and reason flag (bd-1598) |
| `whatsapp-status-pricing.test.js` | Pins pricedFields and the whatsapp.status.priced event per delivered/read status keyed by users.id (bd-v0toag.65) |
| `bug*` | 3 files; most used `bug-014-video-language.test.js`: Pins that video script prompts give Punjabi explicit vocabulary guidance so narration is not Urdu (BUG-014) |
| `llm*` | 6 files; most used `llm-vendor-fallback.test.js`: Pins the OpenAI-behind-other-vendors fallback: used when account cannot spend or supplier is down (bd-4uw7n) |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `ASSESSMENT_GEN_MODEL` · `ASSESSMENT_GEN_MODEL_FDE` · `HCP_FEEDBACK_MODEL` · `LLM_MODEL` · `LP_AUTHOR_MODEL` · `LP_EXTRACTION_VISION_MODEL` · `LP_FIDELITY_MODEL` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `ROSTER_VISION_MODEL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL` (+3)

## Never (human)
- Tests must not reach live services; guard loads via jest.config setupFiles (tests/setup-loopback.test.js:175)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.index.md`? (+38)
