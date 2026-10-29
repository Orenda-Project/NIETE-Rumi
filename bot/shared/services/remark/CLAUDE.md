# remark — Principal's Supervisor Remark (/remark): rubric walk, scores, teacher narrative
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/remark kg=c8ca99cff1fc gen=156de451b0b3 overflow=21 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `remark-rubric.js` — single source of truth for indicators and scoring
- `remark-delivery.service.js` — persist scores, then deliver two outputs
- `remark-score.repository.js` — the entry point for reading s_pct
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `remark*` | 10 files; most used `remark-rubric.js`: Single source of truth for the Supervisor Remark rubric: indicators, anchors, scoring math, export columns (bd-2531) |

## Who reads this (generated)
- `remark-rubric.js` ← imported by `bot/shared/routes/remark-endpoint.js:35:3c373bd4` · `dashboard/services/steps-remarks.service.js:26:db2203b6` (+6)
- table `supervisor_remarks` (written by `remark-delivery.deps.js` (+1)) ← read by `dashboard/routes/portal.routes.js:1674:dec350bb`? · `bot/workers/remark-narrative-retry.worker.js:44:e4257554`? (+3)
- table `supervisor_remark_scores` (written by `remark-write.repository.js`) ← read by `dashboard/routes/portal.routes.js:1675:28d18640`? · `bot/workers/remark-narrative-retry.worker.js:57:18d79377`? (+2)
- column `supervisor_remark_scores.indicator_ordinal` (written by `remark-write.repository.js`) ← read by `bot/workers/remark-narrative-retry.worker.js:58:23ef2f9d` · `bot/shared/services/remark/remark-cycle.repository.js:129:79d071b0` (+1)
- column `supervisor_remark_scores.remark_id` (written by `remark-write.repository.js`) ← read by `bot/workers/remark-narrative-retry.worker.js:59:958d8356` · `bot/shared/services/remark/remark-cycle.repository.js:129:79d071b0` (+1)
- … 10 more → `CLAUDE.index.md`

## Never (human)
- The teacher narrative carries no scores (remark-narrative.service.js:6)
- A submission is never lost to an LLM error: persist before generating (remark-delivery.service.js:13)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/services/remark-delivery-deps.test.js` (remark-delivery.deps.js, remark-rubric.js)
- `bot/tests/services/remark-narrative.test.js` (remark-narrative.service.js, remark-rubric.js)
- … 11 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
