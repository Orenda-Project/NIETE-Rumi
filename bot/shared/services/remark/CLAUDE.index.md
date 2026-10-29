# remark — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/remark -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `remark-cycle.repository.js` | Evaluation cycles and a principal's roster/progress; resume position is derived from written rows (bd-2531) |
| `remark-delivery.deps.js` | Live wiring of the collaborators submitRemark needs, which had no callers before (bd-2712) |
| `remark-delivery.service.js` | submitRemark: persists scores then delivers teacher narrative (no scores) and principal copy (with scores) (bd-2531) |
| `remark-flow.js` | Pure state machine for the /remark rubric walk: five indicator screens, comment, review, submit, no session (bd-2531) |
| `remark-gate.js` | Pure /remark trigger gate: principal role plus deployment switch, mirrors evaluateObserveTrigger (bd-2529) |
| `remark-narrative.service.js` | Writes the teacher-facing Supervisor Remark narrative with no scores, enforced three times (bd-2531) |
| `remark-rubric.js` | Single source of truth for the Supervisor Remark rubric: indicators, anchors, scoring math, export columns (bd-2531) |
| `remark-score.repository.js` | Documented entry point for reading s_pct from the v_supervisor_remark_scores view (bd-2531) |
| `remark-screens.js` | Builds the one-indicator-per-screen rubric texts in English and Urdu for the /remark walk (bd-2531) |
| `remark-write.repository.js` | Write path that persists each answer on arrival, creating the remark header lazily, so no session is needed (bd-2531) |

## Who reads this (all, generated)
- `remark-cycle.repository.js` ← imported by `bot/shared/handlers/remark-command.handler.js:94:5103f386` · `bot/shared/routes/remark-endpoint.js:44:7f40de14`
- `remark-delivery.deps.js` ← imported by `bot/shared/routes/remark-endpoint.js:360:d588bd2d`
- `remark-delivery.service.js` ← imported by `bot/shared/routes/remark-endpoint.js:47:55d4d684` · `bot/workers/remark-narrative-retry.worker.js:35:7790399c`
- `remark-gate.js` ← imported by `bot/shared/handlers/remark-command.handler.js:25:9718ed5b`
- `remark-narrative.service.js` ← imported by `bot/workers/remark-narrative-retry.worker.js:36:427adede` · `bot/shared/services/remark/remark-delivery.deps.js:103:3a38cde5`
- `remark-rubric.js` ← imported by `bot/shared/routes/remark-endpoint.js:35:3c373bd4` · `dashboard/services/steps-remarks.service.js:26:db2203b6` · `bot/shared/services/remark/remark-cycle.repository.js:16:e6428b38` · `bot/shared/services/remark/remark-delivery.service.js:32:fe28fa3e` (+4: `python3 kg/kg.py who-reads remark-rubric.js`)
- `remark-score.repository.js` ← imported by `bot/shared/routes/remark-endpoint.js:46:c48f3ad6`
- `remark-screens.js` ← imported by `bot/shared/handlers/remark-command.handler.js:70:75fd9f8d`
- `remark-write.repository.js` ← imported by `bot/shared/routes/remark-endpoint.js:45:ffbf3ef4`
- column `supervisor_remark_scores.indicator_ordinal` (written by `remark-write.repository.js`) ← read by `bot/workers/remark-narrative-retry.worker.js:58:23ef2f9d` · `bot/shared/services/remark/remark-cycle.repository.js:129:79d071b0` · `bot/shared/services/remark/remark-delivery.deps.js:81:23ef2f9d`
- column `supervisor_remark_scores.remark_id` (written by `remark-write.repository.js`) ← read by `bot/workers/remark-narrative-retry.worker.js:59:958d8356` · `bot/shared/services/remark/remark-cycle.repository.js:129:79d071b0` · `bot/shared/services/remark/remark-delivery.deps.js:82:958d8356`
- column `supervisor_remark_scores.score` (written by `remark-write.repository.js`) ← read by `bot/workers/remark-narrative-retry.worker.js:58:23ef2f9d` · `bot/shared/services/remark/remark-delivery.deps.js:81:23ef2f9d`
- column `supervisor_remarks.submitted_at` (written by `remark-write.repository.js`) ← read by `bot/workers/remark-narrative-retry.worker.js:47:96a4a84c` · `bot/shared/services/remark/remark-cycle.repository.js:121:2aa7eb29`
- table `supervisor_remark_scores` (written by `remark-write.repository.js`) ← read by `dashboard/routes/portal.routes.js:1676:28d18640`? · `bot/workers/remark-narrative-retry.worker.js:57:18d79377`? · `bot/shared/services/remark/remark-cycle.repository.js:128:18d79377`? · `bot/shared/services/remark/remark-delivery.deps.js:80:18d79377`?
- table `supervisor_remarks` (written by `remark-delivery.deps.js`, `remark-write.repository.js`) ← read by `dashboard/routes/portal.routes.js:1675:dec350bb`? · `bot/workers/remark-narrative-retry.worker.js:44:e4257554`? · `bot/shared/services/remark/remark-cycle.repository.js:118:e4257554`? · `bot/shared/services/remark/remark-delivery.deps.js:169:e4257554`? (+1: `python3 kg/kg.py who-reads supervisor_remarks`)

## Tests (all, generated)
- `remark-cycle.repository.js` ← `bot/tests/services/remark-progress-comment.test.js` · `bot/tests/services/remark-wiring.test.js`
- `remark-delivery.deps.js` ← `bot/tests/services/remark-delivery-deps.test.js`
- `remark-delivery.service.js` ← `bot/tests/services/remark-delivery.test.js`
- `remark-flow.js` ← `bot/tests/services/remark-flow.test.js` · `bot/tests/services/remark-progress-comment.test.js`
- `remark-gate.js` ← `bot/tests/services/remark-gate.test.js` · `bot/tests/services/remark-wiring.test.js`
- `remark-narrative.service.js` ← `bot/tests/services/remark-narrative.test.js` · `tests/llm/observe2-moments-job.test.js`
- `remark-rubric.js` ← `bot/tests/services/remark-delivery-deps.test.js` · `bot/tests/services/remark-narrative.test.js` · `bot/tests/services/remark-rubric.test.js` · `bot/tests/services/remark-score-repository.test.js` · `bot/tests/services/remark-screens.test.js` · `tests/remark/remark-flow-contract.test.js`
- `remark-score.repository.js` ← `bot/tests/services/remark-score-repository.test.js`
- `remark-screens.js` ← `bot/tests/services/remark-screens.test.js`
- `remark-write.repository.js` ← `bot/tests/services/remark-write.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.md`?
