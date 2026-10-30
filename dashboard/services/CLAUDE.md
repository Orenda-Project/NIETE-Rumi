# services — Business logic: analytics, coach/teacher app reads, COACHIP, bot HTTP clients, email
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/services kg=ccedaec952b9 gen=f89673acca43 overflow=311 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `telemetry.service.js` — portal logging; the bot's logger is not usable here
- `coachip-shapes.js` — COACHIP wire grammar shared by all handlers
- `leader-patch.service.js` — leader patch teacher resolver
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `api-health/` | One module per vendor for the API-health admin page, aggregated → `api-health/CLAUDE.md` |
| `queue/` | SQS client for portal-only async jobs → `queue/CLAUDE.md` |
| `leader*` | 6 files; most used `leader-patch.service.js`: Resolves a leader's patch teachers (joined to Rumi users, coaching/LP counts, latest score); bd-2387. |
| `telemetry.service.js` | Portal-side structured telemetry sink (Axiom batching) because the bot's pino logger cannot be required in this service. |
| … | 103 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `password-reset.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+174)
- `telemetry.service.js` ← imported by `dashboard/middleware/latency-logger.js:28:2aa9b460` · `dashboard/routes/app-funnel.routes.js:30:2aa9b460` (+13)
- `coaching-frameworks.service.js` ← imported by `dashboard/routes/portal.routes.js:125:fb9750c6` · `dashboard/services/coach-school-card.service.js:32:844e9b68` (+9)
- … 174 more → `CLAUDE.index.md`

## Never (human)
- Never require bot modules needing pino; call the bot over HTTP instead (`telemetry.service.js:8`)
- Never log AWS/ffmpeg err.message in COACHIP media code (`coachip-clip.service.js:7`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` (coach-card-token.js, coach-ping-reasons.js, coach-visit-request.js)
- `tests/coaching/bd-v0toag.79-neutral-question.test.js` (coach-ping-page.js, coaching-report-page.js, coaching-report-view.js)
- … 138 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`? · `docs/attendance-bigquery-sync.md`? · `docs/migration/DEPLOYMENT.md`? · `infrastructure/templates/README.md`?
