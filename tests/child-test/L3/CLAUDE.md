# L3 — Draw (which children are tested) and store (sessions, marks), in-memory DB

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L3 kg=12f3216e12ad gen=42d28d36dfe0 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `draw.test.js` — todaysList and markOutcome rules
- `store.test.js` — session and marks writes
- `seed-guard.test.js` — sandbox seed refuses production
- Run from repo root: `node tests/run.js tests/child-test/L3 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `helpers/` | → (no door; 2 test files) |
| `cycle-shuffle.test.js` | Tests the draw's cycle id (calendar quarters, Pakistan time) and seeded per-class shuffle replayable for audit |
| `draw.test.js` | Tests the child-test draw (todaysList, markOutcome) on in-memory DB: seeded order, 4 new + 1 returning, alternates |
| `draw-add-child.test.js` | Tests add-child-on-the-spot: coach-typed child written to roster and seated as a main row, once per double tap |
| `draw-all-grades.test.js` | Tests the sa_all_grades switch of the draw: ON the coach names grade 1-5 with no 3/5 fallback; OFF keeps Grade 3/5 only |
| `seed-guard.test.js` | Pins that the sandbox seed script refuses a non-sandbox database and refuses to write without --yes-write |
| `store.test.js` | Tests the child-test store: one session per drawn child, AI marks written once, coach marks once, errors not empty |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- The sandbox seed must never write to production nor without being told (tests/child-test/L3/seed-guard.test.js:2)
- AI marks are written once and never changed (tests/child-test/L3/store.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/draw/CLAUDE.index.md`? · `bot/shared/services/child-test/draw/CLAUDE.md`? · `scripts/child-test/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L3/CLAUDE.md`?
