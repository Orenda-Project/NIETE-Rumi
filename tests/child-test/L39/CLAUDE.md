# L39 — Battery v3 review, migration V1.6.1, simulated v3 visit and task list

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L39 kg=1c9eab4df085 gen=d1fb04009265 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `review-v3.test.js` — visitSummary and sendReview
- `migration-v1.6.1.test.js` — widens child_test_blocks.block
- Run from repo root: `node tests/run.js tests/child-test/L39 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 files: 0 test + 1 support) |
| `review-v3.test.js` | L39 (bd-s1oo0.50.5): v3 visitSummary and sendReview from ai-marks-v3 rows: per-task rates, provisional, skipped, gap |
| `review-v3-flow-contract.test.js` | L39 (bd-s1oo0.50.5): a v3 review page is the unchanged v2 review Flow screen; keys, types and caps match the JSON |
| `migration-v1.6.1.test.js` | L39 (bd-s1oo0.50.5): migration V1.6.1 widens child_test_blocks.block to the v3 task ids; no new table or column |
| `tasks.test.js` | L39: the 18 v3 task ids in visit order (Urdu 5, English 5, maths 8) that every lane imports from tasks |
| `sim-v3.test.js` | L39 (bd-s1oo0.50.5): simulated coach plays a full v3 visit with runVisitV3: 18 steps per child, one note per task |

## Who reads this (generated)
- (none)

## Never (human)
- The SQL block list equals tasks.BLOCK_NAMES character for character (tests/child-test/L39/migration-v1.6.1.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/child-test/CLAUDE.md`?
