# portal — Root jest tests pinning the portal's dashboard routes, services and Android shell
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/portal kg=4edb8cb2fecd gen=052b5cf37547 overflow=138 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal-teacher-home.routes.test.js` — typical route suite: real Express over dashboard/routes, injected boundaries
- `helpers/fake-postgrest.js` — in-memory supabase stand-in so real query code runs on fake rows
- Root jest (tests/jest.config.js); from repo root: `node tests/run.js tests/portal --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 4 test files) |
| `helpers/` | Shared fake of the supabase query builder for portal route and service tests → `helpers/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `fln*` | 13 files; most used `fln-routes.test.js`: Pins portal-fln.routes over real Express: access gating, /me, plan, events, funnel logging with real fln-access |
| `analytics*` | 9 files; most used `analytics-schools-route.test.js`: Pins the portal_analytics_only access gate, GET /analytics/schools and the analyticsOnly flag on the user payload |
| … | 133 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `training_modules` (written by `progress-counts.db.test.js`) ← read by `bot/shared/calls/call-context.repo.js:115:a5aff531`? · `bot/shared/routes/teacher-training-endpoint.js:845:3c67573c`? (+14)
- table `niete_lp_downloads` (written by `progress-counts.db.test.js`) ← read by `bot/shared/calls/call-tools.repo.js:123:bdffbacd`? · `bot/shared/services/coaching/analysis-processor.service.js:88:bdffbacd`? (+9)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- Portal routes hold no grading logic; the bot decides (tests/portal/no-local-grading-in-portal-routes.test.js:2, bd-2673)
- Gated routes read the SESSION user, never a body id (tests/portal/bd-fmf24g.30-share-route.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/assessment/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? (+23)
