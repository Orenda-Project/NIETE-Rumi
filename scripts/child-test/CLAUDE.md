# child-test — Child reading/maths test: scoring evals and sandbox simulation helpers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/child-test kg=a273fd4d6646 gen=ba56396ec443 overflow=46 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `eval-scoring.js` — offline eval of the scoreBlock pipeline against fixture keys
- `eval-compare.js` — shared comparison functions and tolerance bands
- `seed-sandbox.js` — seeds the SIM school used by simulation
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `eval*` | 3 files; most used `eval-compare.js`: Shared mark-vs-key comparison functions and tolerance bands used by the child-test eval and the simulation scorer |
| `score-run-compare.js` | Glue that feeds one simulation run's ai_marks and coach_marks to eval-compare and prints per-field summary (bd-s1oo0.18) |
| `seed-sandbox.js` | Idempotently seeds the NIETE sandbox with a marked test school, two classes, a coach and teachers for simulation |
| `smoke-sandbox.js` | Live smoke of the child-test draw and store on the sandbox DB; refuses production, deletes what it wrote (bd-s1oo0.3) |

## Who reads this (generated)
- table `users` (written by `seed-sandbox.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- table `students` (written by `seed-sandbox.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? (+43)
- column `students.student_name` (written by `seed-sandbox.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:317:d73b0171` · `bot/shared/routes/edit-class-endpoint.js:45:dc16e319` (+30)
- … 42 more → `CLAUDE.index.md`

## Never (human)
- Run smoke-sandbox.js on production: it refuses a production project and needs --yes-write (smoke-sandbox.js:15)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L14/eval-compare.test.js` (eval-compare.js, score-run-compare.js)
- `bot/scripts/e2e/child-test-sim/check-play.js` (eval-compare.js)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `.claude/qa/agents/niete-child-test-agent.md`? · `docs/e2e-mock-lane.md`? · `scripts/CLAUDE.md`?
