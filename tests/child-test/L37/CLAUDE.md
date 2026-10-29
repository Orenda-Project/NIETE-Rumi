# L37 — Battery v3 scoring: scoreTask per task kind and the job-runner path

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L37 kg=d3f94d62d164 gen=fcb754138c66 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `score-task.test.js` — one scorer per task kind
- `harness.js` — reply and transcript builders
- Run from repo root: `node tests/run.js tests/child-test/L37 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 files: 0 test + 1 support) |
| `harness.js` | L37 test helpers: build LLM replies and Soniox transcripts for v3 scorer tests; no child, no names |
| `score-task.test.js` | L37 (bd-s1oo0.50.3): scoreTask dispatches one scorer per v3 task kind to ai-marks-v3; only LLM/Soniox/ffmpeg mocked |
| `score-block-v3.test.js` | L37 (bd-s1oo0.50.3): job-runner path for a v3 task row: recovery.runScoring to scoreTask to ai-marks-v3 saved |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/scoring/tasks/CLAUDE.md`? · `portal/scripts/urdu-fit/CLAUDE.md`? · `tests/child-test/CLAUDE.md`?
