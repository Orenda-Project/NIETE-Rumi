# services — Tests for services: /remark (STEPS S), transcription, LP matching, vision
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/services kg=ff6613b31a30 gen=10f8be1b40b8 overflow=14 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `remark-rubric.test.js` — rubric contract behind /remark scoring
- `remark-narrative.test.js` — teacher never sees a score
- `capability.test.js` — data-driven capability gating
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `reading/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `remark*` | 14 files; most used `remark-wiring.test.js`: Source guard that text-message.handler.js has the /remark branch, calls the handler and returns when handled (bd-2531) |
| `CLAUDE.md` | (unmapped) |
| `lp-feedback.service.test.js` | Integration tests: LpFeedbackService: delayed prompt, Urdu prompt, button handling with mocked Redis, Supabase, WhatsApp |
| `bd-2kxxa3-whisper-extension-convert.test.js` | Pins that the Whisper last-resort path transcodes .aac/.amr containers to mp3 via ffmpeg before upload (bd-2kxxa.3 T4b) |
| `settings-group.test.js` | Tests settings-group: one app_settings read for a host switch plus riders, with absence and failure handling |
| `bd-gc1ge-remark-roster-nameless.test.js` | Pins that the /remark roster never prints the literal 'null' or an empty gap for a nameless teacher (bd-gc1ge) |
| `capability.test.js` | Pins the capability registry and hasCapability resolving from data (e.g. remark.author), not a hardcoded list (bd-2531) |
| `coach-voice-note-retention.test.js` | Pins 30-day coach voice-note retention sweep: R2 delete then null key, retry on failure, bounded batches (bd-v0toag.67) |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `LP612_PAGE_TRUTH_DIR` · `OPENAI_API_KEY`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/authz/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? (+7)
