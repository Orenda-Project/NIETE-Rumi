# monitoring — Lesson-plan health (hourly) and quiz-funnel (2-hourly) watcher alerts to operators

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/monitoring kg=6ff234246a4b gen=a7eef336e1cb overflow=0 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `lesson-plan-health.service.js` — reads lesson_plan_requests, alerts when unhealthy
- `quiz-funnel-watch.service.js` — one Slack DM stream, de-duplicated
- `prod-incident-watch.service.js` — rule-based production alerts to one Slack channel, no model; replay with `bot/scripts/prod-incident-watch.js --dry-run`
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-funnel-watch.service.js` | Quiz funnel watcher sending the operator one Slack DM stream with chronic-family de-duplication |
| `lesson-plan-health.service.js` | Hourly lesson-plan health summary over lesson_plan_requests, alerting a person when a path is unhealthy |
| `prod-incident-watch.service.js` | (unmapped) |
| `web-quiz-voice-watch.service.js` | (unmapped) |

## Who reads this (generated)
- `quiz-funnel-watch.service.js` ← imported by `bot/scripts/quiz-funnel-watch.js:59:ba7c8c89` · `bot/shared/services/ab-tracker/ab-tracker-rollup.service.js:149:02370cee` (+8)
- `lesson-plan-health.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1476:02e8fa18` · `bot/workers/sqs-worker.js:1917:972f943e`
- `prod-incident-watch.service.js` ← imported by `bot/workers/sqs-worker.js:1798:7723305a` · `bot/scripts/prod-incident-watch.js:176:60d1b23c`
- `web-quiz-voice-watch.service.js` ← imported by `bot/workers/web-quiz-voice-watch-schedule.js:15:b69a8ddc`

## Never (human)
- lesson_plan_requests is also read by `bot/shared/services/teacher-state.service.js:93` (who-reads); keep column names
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/qfix-voice/web-quiz-voice-watch.test.js` (web-quiz-voice-watch.service.js)
- `tests/lesson-plan-lifecycle/health-check.test.js` (lesson-plan-health.service.js)
- `tests/lesson-plan-lifecycle/health-tick-cadence.test.js` (lesson-plan-health.service.js)
- `tests/quiz/quiz-funnel-watch-owed.test.js` (quiz-funnel-watch.service.js)
- `tests/quiz/quiz-funnel-watch.test.js` (quiz-funnel-watch.service.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/monitoring.md`? · `docs/quiz-telemetry.md`?
