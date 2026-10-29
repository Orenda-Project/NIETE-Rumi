# routes — Express routers: portal API, coach/teacher app APIs, child-quiz edge pages, admin routes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/routes kg=c1cfd92c1914 gen=e0f9ad4c43da overflow=385 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `portal.routes.js` — main /api/portal API (9k lines)
- `edge-mounts.js` — ordered list of flag-gated edge routers mounted as one block
- `web-quiz.routes.js` — child quiz public edge forwarding to the bot
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `portal.routes.js` | Main teacher/coach portal API at /api/portal: auth, setup, reset, dashboard, lessons, coaching, training; 9k lines. |
| `web*` | 15 files; most used `web-quiz.routes.js`: Child web-quiz public edge: /q/:code pages, share art, /api/wq/* forwarded to the bot, hub /h, landing /k; 2.1k lines. |
| `sa*` | 5 files; most used `sa-battery-switches.js`: Applies app_settings content switches (practice, passage rotation, RDF W3 forms) to a battery file as served. |
| … | 60 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `portal.routes.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- `web-quiz.routes.js` ← imported by `dashboard/index.js:171:a0c5436b` · `dashboard/routes/first-touch.routes.js:23:618f2a96` (+8)
- … 109 more → `CLAUDE.index.md`

## Never (human)
- Never let an edge router answer while its switch is off; it must call next() (`edge-mounts.js:5`)
- Never take the teacher from the request; use the session user (`portal-share.routes.js:9`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/edge-relay-harness.js` (first-touch.routes.js, quiz-go.routes.js, quiz-teacher.routes.js, teacher-report.routes.js, teacher-stories.routes.js)
- `tests/coachip/coachip-golden.test.js` (portal-child-test.routes.js, portal-coachip.routes.js, portal-fln.routes.js, portal.routes.js)
- … 255 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`? · `docs/app-funnel-telemetry.md`? · `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `docs/reports/bug131-phase4-media-complete.md`? · `tests/BASELINE.md`?
