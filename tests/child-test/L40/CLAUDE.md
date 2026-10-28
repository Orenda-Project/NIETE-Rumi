# L40 — Fixes from the v3 sandbox e2e: scoring defects, finish time, review seam

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L40 kg=6184b6aa01bd gen=c15e2b0c1096 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `e2e-scoring-fixes.test.js` — renderTurns and begin lines
- `review-seam.test.js` — review reads L37 marks as written
- Run from repo root: `node tests/run.js tests/child-test/L40 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `e2e-scoring-fixes.test.js` | bd-s1oo0.50.9: three v3 scoring defects from the first sandbox e2e, e.g. renderTurns cut at 500 chars hid the questions |
| `review-seam.test.js` | v3 integration seam (bd-s1oo0.50): review reads items exactly as L37 scoring writes them (1-based i, q:<id> names) |
| `CLAUDE.md` | (unmapped) |
| `finish-time.test.js` | bd-s1oo0.50.11: a finished reader's time left comes from where the passage ends, not a diarized speaker's last word |
| `story-finish-time.test.js` | bd-s1oo0.50.11 on the story path: time left comes from the passage's final word, not a mid-passage word |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L40/CLAUDE.md`?
