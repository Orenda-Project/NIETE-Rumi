# services — Business logic: analytics, coach/teacher app reads, COACHIP, bot HTTP clients, email
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/services kg=b5ee29c84eca gen=15948a6912a2 overflow=312 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `CLAUDE.index.md` | (unmapped) |
| `leader*` | 6 files; most used `leader-patch.service.js`: Resolves a leader's patch teachers (joined to Rumi users, coaching/LP counts, latest score); bd-2387. |
| … | 54 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `password-reset.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- `telemetry.service.js` ← imported by `dashboard/middleware/latency-logger.js:28:2aa9b460` · `dashboard/routes/app-funnel.routes.js:30:2aa9b460` (+13)
- `coaching-frameworks.service.js` ← imported by `dashboard/routes/portal.routes.js:124:fb9750c6` · `dashboard/services/coach-school-card.service.js:29:844e9b68` (+9)
- … 121 more → `CLAUDE.index.md`

## Never (human)
- Never require bot modules needing pino; call the bot over HTTP instead (`telemetry.service.js:8`)
- Never log AWS/ffmpeg err.message in COACHIP media code (`coachip-clip.service.js:7`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` (coach-card-token.js, coach-ping-reasons.js, coach-visit-request.js)
- `tests/coaching/bd-v0toag.79-neutral-question.test.js` (coach-ping-page.js, coaching-report-page.js, coaching-report-view.js)
- … 137 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/services/CLAUDE.index.md`? · `dashboard/services/CLAUDE.md`? · `dashboard/services/api-health/CLAUDE.index.md`? · `dashboard/services/api-health/CLAUDE.md`? (+35)
