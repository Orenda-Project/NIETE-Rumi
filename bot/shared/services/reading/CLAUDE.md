# reading — Reading assessment: transcript, pronunciation, fluency, comprehension, PDF report
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/reading kg=421eee301895 gen=8aa272527e1d overflow=28 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `analysis.service.js` — orchestrates the whole analysis pipeline
- `auto-level-orchestrator.service.js` — ASER-style adaptive levels
- `benchmark.service.js` — thresholds come from config/reading-benchmarks.js
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `analysis.service.js` | Orchestrates the reading-assessment analysis pipeline: Soniox transcript, student segments, pronunciation, fluency,... |
| `comprehension.service.js` | Generates 5 EGRA-style comprehension questions and evaluates bilingual answers against the 3-of-5 benchmark |
| `benchmark.service.js` | Config-driven JS reimplementation of the benchmark SQL RPCs; thresholds live in config/reading-benchmarks.js |
| `passage-generation.service.js` | Generates grade-appropriate reading passages with an LLM, renders passage images with Canvas, uploads to R2, sends... |
| `CLAUDE.index.md` | (unmapped) |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `reading_assessments` (written by `analysis.service.js` (+2)) ← read by `bot/shared/handlers/flow-response.handler.js:326:4337985e`? · `bot/shared/handlers/text-message.handler.js:1734:4337985e`? (+13)
- column `reading_assessments.status` (written by `analysis.service.js` (+2)) ← read by `bot/shared/handlers/voice-message.handler.js:490:1099729a` · `bot/shared/services/context.service.js:170:a69ef692` (+5)
- … 19 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/reading/benchmark-service.test.js` (benchmark.service.js)
- `tests/reading/voice-feedback-gateway.test.js` (voice-feedback.service.js)
- … 1 more → `CLAUDE.index.md`

## Related (generated)
- skills: `reading-assessment`?
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/reading/CLAUDE.index.md`? · `bot/shared/services/reading/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/agent-customization.md`? (+3)
