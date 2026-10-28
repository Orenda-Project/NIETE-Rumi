# L24 — Change requests CR-1..3 from the L23 study: bars, stop rule, story minute

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L24 kg=81e2d46c41a9 gen=4bc9ac27629e overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `questions-bar.test.js` — Urdu questions bar 0.90
- `stop-rule.test.js` — a reading child is not stopped
- Run from repo root: `node tests/run.js tests/child-test/L24 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `questions-bar.test.js` | L24 CR-1 (bd-s1oo0.42): Urdu questions pre-fill bar goes 0.70 to 0.90, with L23 evidence, in bars and thresholds |
| `story-minute.test.js` | L24 CR-3 (bd-s1oo0.42): the story minute is not cut short while the child still reads; question-text anchor matching |
| `score-block-wiring.test.js` | L24 CR-2/CR-3 (bd-s1oo0.42): scoreBlock wiring for the line-1 stop rule and story minute; only HTTP/R2 boundaries mocked |
| `stop-rule.test.js` | L24 CR-2 (bd-s1oo0.42): the stop rule does not send a child to letters+words when their own count shows they read |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L24/CLAUDE.md`?
