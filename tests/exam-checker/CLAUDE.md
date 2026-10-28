# exam-checker — Exam checker: grading schema contract, confirm-students Flow, missing-canvas boot

<!-- kg:meta repo=NIETE-Rumi dir=tests/exam-checker kg=b82060796182 gen=987fdca9fa3a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `grading-service.test.js` — _saveGrade writes exam_submissions then exam_grades with real columns
- `canvas-missing.test.js` — missing canvas degrades annotation only (bd-vq0mfv)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/exam-checker --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `confirm-students-flow.test.js` | bd-1875: exam-checker "confirm students" Flow wiring: exam-confirm endpoint INIT, orchestrator, completion routing |
| `grading-service.test.js` | GradingService._saveGrade writes exam_submissions then exam_grades using real columns, one grade row per question |
| `CLAUDE.md` | (unmapped) |
| `canvas-missing.test.js` | bd-vq0mfv: a missing canvas degrades only exam annotation; exam-grading worker and exam-checker index still load |

## Who reads this (generated)
- (none)

## Never (human)
- A missing canvas must not stop the exam-grading worker loading (bd-vq0mfv, tests/exam-checker/canvas-missing.test.js:30)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/exam-checker/CLAUDE.index.md`? · `bot/shared/services/exam-checker/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/exam-checker/CLAUDE.md`?
