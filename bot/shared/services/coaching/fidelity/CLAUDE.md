# fidelity — Lesson-plan fidelity (Section B): grade moves vs transcript, score in code
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/fidelity kg=692aad1bdb29 gen=459f9378cba1 overflow=43 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `fidelity-orchestrator.js` — entry point; resolves moves, grades, scores
- `fidelity-scorer.js` — all arithmetic lives here, not in the LLM
- `fidelity-telemetry.js` — keys to strip before prompts
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fidelity*` | 6 files; most used `fidelity-orchestrator.js`: Never-throwing orchestrator: resolves prescribed moves, grades vs transcript, scores, returns the lp_fidelity blob |
| `grader-prompt.js` | The fidelity grader brief text and user-message builder, kept in sync with the offline eval brief |
| `grader-photo-evidence.js` | Builds the tagged classroom_photo_evidence block and credit rules appended to the fidelity grader prompt (bd-b3pop.15) |
| … | 7 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `fidelity-recompute.service.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- `fidelity-orchestrator.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:415:d298275c` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:59:7d821bd0` (+5)
- … 13 more → `CLAUDE.index.md`

## Never (human)
- Orchestrator never throws; failure returns fidelity_unavailable (fidelity-orchestrator.js:9)
- Telemetry keys must not reach teacher-facing prompts; use stripFidelityTelemetry (fidelity-telemetry.js:3-4)
- Photo-only credit is capped in code, not by prompt (photo-credit-guard.js:5-8, bd-b3pop)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/fidelity/fidelity-analyzer-v2.test.js` (fidelity-analyzer.js, grader-photo-evidence.js, grader-prompt.js)
- `tests/coaching/fidelity/fidelity-analyzer.test.js` (fidelity-analyzer.js, fidelity-scorer.js, grader-prompt.js)
- … 23 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.md`?
