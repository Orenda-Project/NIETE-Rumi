# L3b — Visit keys for a child test with no observe2 form (day key, cs:<id>, grade)

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L3b kg=d9f8f2f29597 gen=20fafa05fd27 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `visit-key.test.js` — visitKeyFor and parseVisitKey
- `machine-visit-key.test.js` — /egra naming the visit
- Run from repo root: `node tests/run.js tests/child-test/L3b --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `machine-visit-key.test.js` | Tests naming a visit by day key when no observe2 form exists, or cs:<id> after classic /observe (bd-s1oo0.11) |
| `visit-key.test.js` | Tests visitKeyFor/parseVisitKey for visits without an observe2 form: cs:<session id> and day:<coach>:<school>:<date> |
| `visit-key-grade.test.js` | Tests the day visit key with a grade suffix :g<N> (sa_all_grades); the plain key parses unchanged |
| `CLAUDE.md` | (unmapped) |
| `draw-same-day-lists.test.js` | Tests that same-day lists stay disjoint across grades under sa_all_grades: a child is never on two of a coach's lists |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/conversation/CLAUDE.index.md`? · `bot/shared/services/child-test/draw/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L3b/CLAUDE.md`?
