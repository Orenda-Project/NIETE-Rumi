# fidelity — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/fidelity -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fidelity-analyzer.js` | LLM grader returning per-move verdicts only (never a score) for lesson-plan fidelity; client injectable (bd-b3pop) |
| `fidelity-orchestrator.js` | Never-throwing orchestrator: resolves prescribed moves, grades vs transcript, scores, returns the lp_fidelity blob |
| `fidelity-preflight.js` | Pure recording facts (timestamp count, transcript-vs-audio end) stored as lp_fidelity.recording telemetry (bd-b3pop.5) |
| `fidelity-recompute.service.js` | Recomputes only the fidelity section when a lesson plan arrives after analysis ran (bd-5knlj) |
| `fidelity-scorer.js` | Deterministic arithmetic turning grader verdicts and move tags into the fidelity percent and persisted blob |
| `fidelity-telemetry.js` | Strips grading/photo telemetry keys from an analysis before it is serialised into any teacher-facing prompt |
| `grader-photo-evidence.js` | Builds the tagged classroom_photo_evidence block and credit rules appended to the fidelity grader prompt (bd-b3pop.15) |
| `grader-prompt.js` | The fidelity grader brief text and user-message builder, kept in sync with the offline eval brief |
| `lp-fidelity-store.js` | Reads and upserts prescribed move-lists in niete_lp_fidelity_moves, keyed by the exact downloaded LP version |
| `lp-upload-extractor.js` | Extracts a fidelity move-list from a teacher's own uploaded lesson-plan text via LLM (bd-wmfsp.4) |
| `photo-credit-guard.js` | Caps photo-only credit in code so chalk-board text alone cannot earn a full mark (bd-b3pop security F1) |
| `section-b-backfill.service.js` | One-off repair re-transcribing stranded observations from R2 audio and recomputing Section B fidelity (bd-2kxxa.5) |
| `upload-extractor-prompt.js` | Prompt brief and builder for extracting teaching moves from an uploaded lesson plan, synced with eval 6 |

## Who reads this (all, generated)
- `fidelity-analyzer.js` ← imported by `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:111:1a9dc13a`
- `fidelity-orchestrator.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:415:d298275c` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:59:7d821bd0` · `bot/shared/services/observe/observe-resume.service.js:91:2f86f565` · `bot/shared/services/observe/observe2/moments.js:268:014e6041` (+3: `python3 kg/kg.py who-reads fidelity-orchestrator.js`)
- `fidelity-preflight.js` ← imported by `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:25:e71f6991`
- `fidelity-recompute.service.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:714:a79a0eaf` · `bot/shared/services/coaching/lp-coaching/lp-list-selection.handler.js:25:1c860c44` · `bot/workers/lesson-plan-extraction.worker.js:255:9416f4f0`
- `fidelity-scorer.js` ← imported by `bot/shared/services/observe/observe-draft.service.js:235:a620f25a` · `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:112:f88d2867` · `bot/shared/services/coaching/fidelity/photo-credit-guard.js:12:8dcb83d7`
- `fidelity-telemetry.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:85:a8255ac2` · `bot/shared/services/observe/observe-debrief-guide.js:52:e2801e71`
- `grader-photo-evidence.js` ← imported by `bot/shared/services/coaching/fidelity/fidelity-analyzer.js:30:11c5e5d6` · `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:23:51e9dbb9`
- `grader-prompt.js` ← imported by `bot/shared/services/coaching/fidelity/fidelity-analyzer.js:29:dacc59a8`
- `lp-fidelity-store.js` ← imported by `bot/shared/calls/call-tools.repo.js:167:4113e5d4` · `bot/shared/services/lp-context.service.js:48:c9ea5563` · `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:109:9de6ea80`
- `lp-upload-extractor.js` ← imported by `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:110:43e8f4a2`
- `photo-credit-guard.js` ← imported by `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:24:d6b78b0d`
- `section-b-backfill.service.js` ← imported by `bot/scripts/backfill-section-b-retranscribe.js:159:f70a1f2f`
- `upload-extractor-prompt.js` ← imported by `bot/shared/services/coaching/fidelity/lp-upload-extractor.js:12:a1861133`
- table `coaching_sessions` (written by `fidelity-recompute.service.js`, `section-b-backfill.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- env `LP_FIDELITY_EMPTY_RETRY_EFFORT` read at `bot/shared/services/coaching/fidelity/fidelity-analyzer.js:54:b46a7780`
- env `LP_FIDELITY_ENABLED` read at `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:64:41aed0ea`
- env `LP_FIDELITY_MAX_TOKENS` read at `bot/shared/services/coaching/fidelity/fidelity-analyzer.js:59:311e6594`
- env `LP_FIDELITY_PHOTO` read at `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:58:b2c8cf0d`
- env `LP_FIDELITY_REASONING_EFFORT` read at `bot/shared/services/coaching/fidelity/fidelity-analyzer.js:47:7390846c`
- env `LP_FIDELITY_RUNS` read at `bot/shared/services/coaching/fidelity/fidelity-orchestrator.js:50:dd0eaa8a`

## Tests (all, generated)
- `fidelity-analyzer.js` ← `tests/coaching/fidelity/fidelity-analyzer-empty-retry-effort.test.js` · `tests/coaching/fidelity/fidelity-analyzer-v2.test.js` · `tests/coaching/fidelity/fidelity-analyzer.test.js` · `tests/coaching/fidelity/grader-prompt-substitution-calibration.test.js`
- `fidelity-orchestrator.js` ← `tests/coaching/fidelity/corpus-ref-carries-subject.test.js` · `tests/coaching/fidelity/fidelity-analyzer-empty-retry-effort.test.js` · `tests/coaching/fidelity/fidelity-orchestrator-unusable-guard.test.js` · `tests/coaching/fidelity/fidelity-orchestrator-v2.test.js` · `tests/coaching/fidelity/fidelity-orchestrator.test.js` · `tests/coaching/fidelity/fidelity-recompute.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/coaching/fidelity/fidelity-orchestrator.js`)
- `fidelity-preflight.js` ← `tests/coaching/fidelity/fidelity-preflight.test.js`
- `fidelity-recompute.service.js` ← `tests/coaching/bd-2c1gj-lp-select-confirm.test.js` · `tests/coaching/fidelity/fidelity-recompute-v2-inputs.test.js` · `tests/coaching/fidelity/fidelity-recompute.test.js`
- `fidelity-scorer.js` ← `tests/coaching/fidelity/fidelity-analyzer.test.js` · `tests/coaching/fidelity/fidelity-scorer.test.js` · `tests/coaching/fidelity/lp-upload-extractor.test.js` · `tests/coaching/fidelity/truncation-inconsistent.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js`
- `grader-photo-evidence.js` ← `tests/coaching/bd-b3pop-processor-photo-evidence.test.js` · `tests/coaching/fidelity/fidelity-analyzer-v2.test.js` · `tests/coaching/fidelity/grader-photo-evidence.test.js`
- `grader-prompt.js` ← `tests/coaching/bd-b3pop-processor-photo-evidence.test.js` · `tests/coaching/fidelity/fidelity-analyzer-v2.test.js` · `tests/coaching/fidelity/fidelity-analyzer.test.js` · `tests/coaching/fidelity/grader-prompt-substitution-calibration.test.js` · `tests/coaching/observe-gates.test.js`
- `lp-fidelity-store.js` ← `tests/coaching/fidelity/lp-fidelity-store.test.js`
- `lp-upload-extractor.js` ← `tests/coaching/fidelity/lp-upload-extractor.test.js` · `tests/config/job-labels-coverage.test.js`
- `photo-credit-guard.js` ← `tests/coaching/fidelity/photo-credit-guard.test.js`
- `section-b-backfill.service.js` ← `tests/coaching/fidelity/section-b-backfill-v2-inputs.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
