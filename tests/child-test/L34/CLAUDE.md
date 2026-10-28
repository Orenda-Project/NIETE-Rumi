# L34 — Reach rule: a question counts only if the child read to its line and it was

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L34 kg=fc9e2f1be38b gen=947da6ed2965 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `reach.test.js` — needs_line rule
- `review-reach.test.js` — results and review respect reach
- Run from repo root: `node tests/run.js tests/child-test/L34 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `coach-card-reach.test.js` | L34 (bd-s1oo0.47): coach card prints the same reach condition and anchor words under each gated question as the step |
| `step-reach.test.js` | L34 (bd-s1oo0.47): story step message tells the coach which questions to ask, with anchor words, within the 4096 cap |
| `CLAUDE.md` | (unmapped) |
| `comprehension-reach.test.js` | L34 (bd-s1oo0.47): comprehension is scored out of questions reached and asked; only the openai SDK boundary mocked |
| `reach.test.js` | L34 (bd-s1oo0.47): the reach rule: a question with needs_line k is reached iff words_attempted passes that line's end |
| `review-reach.test.js` | L34 (bd-s1oo0.47): results line and end-of-visit review respect reach: no unreached or unasked questions listed |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/conversation/CLAUDE.index.md`? · `bot/shared/services/child-test/render/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? (+1)
