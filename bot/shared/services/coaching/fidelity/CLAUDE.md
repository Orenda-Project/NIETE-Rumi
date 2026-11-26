# fidelity — Lesson-plan fidelity (Section B): grade moves vs transcript, score in code
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/fidelity kg=6bdd72a06bda gen=000db957151b overflow=45 rendered=2026-11-25 kg.py=1.1.0 -->

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
| `lp-fidelity-store.js` | Reads and upserts prescribed move-lists in niete_lp_fidelity_moves, keyed by the exact downloaded LP version |
| … | 9 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `fidelity-recompute.service.js` (+1)) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/scripts/quiz/backfill-quiz-lesson-links.js:76:0b673d4d`? (+103)
- `fidelity-orchestrator.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:472:d298275c` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:62:7d821bd0` (+4)
- … 18 more → `CLAUDE.index.md`

## Never (human)
- Orchestrator never throws; failure returns fidelity_unavailable (fidelity-orchestrator.js:9)
- Telemetry keys must not reach teacher-facing prompts; use stripFidelityTelemetry (fidelity-telemetry.js:3-4)
- Photo-only credit is capped in code, not by prompt (photo-credit-guard.js:5-8, bd-b3pop)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/fidelity/fidelity-analyzer-v2.test.js` (fidelity-analyzer.js, grader-photo-evidence.js, grader-prompt.js)
- `tests/coaching/fidelity/fidelity-analyzer.test.js` (fidelity-analyzer.js, fidelity-scorer.js, grader-prompt.js)
- … 28 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
