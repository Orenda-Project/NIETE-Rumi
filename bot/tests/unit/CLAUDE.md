# unit — Small unit tests: logging, tracing, syntax guard, cassette, report styling

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/unit kg=dc999acd528c gen=5fcefa51a2b7 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `check-syntax.test.js` — proves the deploy syntax guard fails on malformed files
- `e2e-cassette.test.js` — record/replay, forced off against production
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `bd-2452-niete-hero-brand.test.js` | Pins that the FICO hero report template emits NIETE green and navy-slate, not the Rumi palette (bd-2452) |
| `e2e-cassette.test.js` | Pins the E2E cassette record/replay for Soniox, LLM and ElevenLabs, forced off against the NIETE production database |
| `logger.test.js` | Tests logToFile with correlation: correlationId included with data, null data and when missing |
| `tracing.test.js` | Tests tracing withSpan: duration, error status when the function throws, parent/child span linking |
| `bd-d26qh-bidi-mixed-latin-digit.test.js` | Pins that a mixed Latin+digit quote in the Urdu coaching report renders as one LTR run, not reversed (bd-d26qh) |
| `bot-helpers-lesson-plan.test.js` | Tests storeLessonPlan duplicate prevention within a 10-minute window (bot-helpers) |
| `check-syntax.test.js` | Tests the pre-deploy syntax checker: fails on malformed files such as a stray brace, never executes them (bd-wpx18) |
| `hero-report-style.test.js` | Pins hero-report.style constants: palettes share keys across brands, each language has chrome copy (bd-v0toag.59) |
| `r2-bucket-options.test.js` | Pins that r2.js presign, download and delete can each name a bucket, defaulting to R2_BUCKET_NAME |
| `structured-logger.test.js` | Tests structured-logger logEvent: event name parsed to feature/action/result and correlationId from context |

## Who reads this (generated)
- (none)

## Never (human)
- E2E cassette is forced off against the NIETE production database (tests/unit/e2e-cassette.test.js:40)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/database/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/report-renderers/CLAUDE.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? (+4)
