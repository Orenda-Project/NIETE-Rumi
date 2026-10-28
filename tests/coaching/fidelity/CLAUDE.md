# fidelity — Tests for lesson-plan fidelity: grader, scorer, orchestrator, LP linking and selection
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching/fidelity kg=11090706d196 gen=24864845333d overflow=8 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `fidelity-orchestrator.test.js` — corpus or uploaded move-list, grade, score, persist blob; start here
- `fidelity-scorer.test.js` — deterministic executed/partial/not_done percentage maths, no LLM
- Run from repo root: `node tests/run.js tests/coaching/fidelity --maxWorkers=2` (tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `fidelity*` | 11 files; most used `fidelity-analyzer.test.js`: P3.1: fidelity LLM grader call shape and parsing with the model mocked; grader never sees the deterministic bucket |
| `CLAUDE.md` | (unmapped) |
| `corpus-ref-carries-subject.test.js` | resolveCorpusRef carries the subject and grade encoded in the lesson_id through to the fidelity meta (orchestrator) |
| `recent-fidelity-lps-app-opens.test.js` | Recent plans list also includes plans read in the app, deduped by lesson at newest use (recent-fidelity-lps.service) |
| `grader-prompt-substitution-calibration.test.js` | bd-xkq6q: grader prompt rules calibrating substitution verdicts so different-content moves are not scored not_done |
| `lp*` | 5 files; most used `lp-upload-extractor.test.js`: P1.3: uploaded-LP extractor with LLM mocked: image-only PDF fails loud, tags normalised for grader parity |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `LP_FIDELITY_RUNS`

## Never (human)
- Photo credit is capped in code, not by the prompt (`photo-credit-guard.test.js:3`)
- A transcript without [MM:SS] stamps is decided in code before any model call (`fidelity-orchestrator-unusable-guard.test.js:3`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `tests/BASELINE.md`? (+5)
