# monitoring — Lesson-plan health (hourly) and quiz-funnel (2-hourly) watcher alerts to operators

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/monitoring kg=93d7690ff926 gen=559c07b0cbbd overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `lesson-plan-health.service.js` — reads lesson_plan_requests, alerts when unhealthy
- `quiz-funnel-watch.service.js` — one Slack DM stream, de-duplicated
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-funnel-watch.service.js` | Quiz funnel watcher sending the operator one Slack DM stream with chronic-family de-duplication |
| `lesson-plan-health.service.js` | Hourly lesson-plan health summary over lesson_plan_requests, alerting a person when a path is unhealthy |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `quiz-funnel-watch.service.js` ← imported by `bot/scripts/quiz-funnel-watch.js:59:ba7c8c89` · `bot/workers/sqs-worker.js:1612:731ec202` (+1)
- `lesson-plan-health.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1371:02e8fa18` · `bot/workers/sqs-worker.js:1727:972f943e`

## Never (human)
- lesson_plan_requests is also read by `bot/shared/services/teacher-state.service.js:93` (who-reads); keep column names
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/lesson-plan-lifecycle/health-check.test.js` (lesson-plan-health.service.js)
- `tests/lesson-plan-lifecycle/health-tick-cadence.test.js` (lesson-plan-health.service.js)
- `tests/quiz/quiz-funnel-watch.test.js` (quiz-funnel-watch.service.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `docs/quiz-telemetry.md`?
