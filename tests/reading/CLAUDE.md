# reading — Tests the reading-assessment seams: benchmarks, availability gate, copy, voice

<!-- kg:meta repo=NIETE-Rumi dir=tests/reading kg=6089f0c04b30 gen=56fdb7fa7ed5 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `reading-availability-gate.test.js` — /reading stays honest when no Flow is provisioned
- `benchmark-service.test.js` — benchmark status conformance (bd-1833)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/reading --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `benchmark-service.test.js` | bd-1833: conformance for reading benchmark.service getBenchmarkStatus (grade, language, WCPM/LCPM, percentiles) |
| `reading-availability-gate.test.js` | Pins /reading honesty: with no reading Flow provisioned it does not try to send and replies in the teacher's language |
| `CLAUDE.md` | (unmapped) |
| `voice-feedback-gateway.test.js` | Pins reading voice feedback speaking through the TTS gateway (Soniox, per-use-case TTS_PROVIDER_READING override) |
| `reading-welcome-copy.test.js` | Pins that reading-assessment welcome and picker copy come from the ux-strings catalog, not a runtime model translation |

## Who reads this (generated)
- (none)

## Never (human)
- Reading must not be advertised where no reading Flow is provisioned (reading-availability-gate.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/reading/CLAUDE.index.md`? · `bot/shared/services/reading/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/customization.md`? (+3)
