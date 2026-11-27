# tests — Jest suite for the NIETE bot: unit, handler, worker, LP and call tests
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests kg=fe1ebc2b18f7 gen=b344b0af3848 overflow=1 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `setup-loopback.js` — jest setupFile blocking live DB/Redis/LLM/WhatsApp in every test
- `helpers/table-double.js` — in-memory Supabase double; reuse instead of hand-rolled mocks
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 8 sub-dirs, each with `CLAUDE.md` | `child-test/` · `coaching/` · `fa-video/` · `first-touch/` · `helpers/` · `lp-v8/` · `observe/` · `quiz/` |
| 32 sub-dirs without a door | `assessment/` (4 tests) · `calls/` (30 tests) · `fixtures/` (44 tests) · `handlers/` (12 tests) · `howto/` (2 tests) · +27 more → `CLAUDE.index.md` |
| `student-video-feedback.test.js` | Tests StudentVideoFeedbackService thumbs-up/down button handling, snapshot insert and reason flag (bd-1598) |
| `whatsapp-status-pricing.test.js` | Pins pricedFields and the whatsapp.status.priced event per delivered/read status keyed by users.id (bd-v0toag.65) |
| `bug*` | 3 files; most used `bug-014-video-language.test.js`: Pins that video script prompts give Punjabi explicit vocabulary guidance so narration is not Urdu (BUG-014) |
| `model*` | 6 files; most used `model-pilot-vision.test.js`: Pins the vision.analyse model pilot through the registry: default gpt-4.1-mini, VISION_MODEL honoured (bd-5rd2f) |
| `llm*` | 7 files; most used `llm-vendor-fallback.test.js`: Pins the OpenAI-behind-other-vendors fallback: used when account cannot spend or supplier is down (bd-4uw7n) |
| `objective-writer-model.test.js` | (unmapped) |
| `secondary-writer-model.test.js` | (unmapped) |
| `r2-download-miss-level.test.js` | (unmapped) |
| `video-reco-status-webhook.test.js` | Pins clip message delivered/read/failed statuses reach video_reco_events through the real status webhook (bd-gzfdu9) |
| … | 54 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Tests must not reach live services; guard loads via jest.config setupFiles (tests/setup-loopback.test.js:175)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.md`? · `bot/shared/services/video/CLAUDE.md`?
