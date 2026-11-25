# monitoring — Lesson-plan health (hourly) and quiz-funnel (2-hourly) watcher alerts to operators

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/monitoring kg=3bc5746aab03 gen=67913fbd0f8b overflow=0 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `lesson-plan-health.service.js` — reads lesson_plan_requests, alerts when unhealthy
- `quiz-funnel-watch.service.js` — one Slack DM stream, de-duplicated
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-funnel-watch.service.js` | Quiz funnel watcher sending the operator one Slack DM stream with chronic-family de-duplication |
| `lesson-plan-health.service.js` | Hourly lesson-plan health summary over lesson_plan_requests, alerting a person when a path is unhealthy |
| `web-quiz-voice-watch.service.js` | (unmapped) |

## Who reads this (generated)
- `quiz-funnel-watch.service.js` ← imported by `bot/scripts/quiz-funnel-watch.js:59:ba7c8c89` · `bot/shared/services/ab-tracker/ab-tracker-rollup.service.js:149:02370cee` (+6)
- `lesson-plan-health.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1472:02e8fa18` · `bot/workers/sqs-worker.js:1733:972f943e`
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
- docs: `bot/shared/services/CLAUDE.md`? · `docs/quiz-telemetry.md`?
