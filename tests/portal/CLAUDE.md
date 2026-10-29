# portal — Root jest tests pinning the portal's dashboard routes, services and Android shell
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/portal kg=1ff2597fa9b5 gen=519a0d3abc31 overflow=131 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `portal-teacher-home.routes.test.js` — typical route suite: real Express over dashboard/routes, injected boundaries
- `helpers/fake-postgrest.js` — in-memory supabase stand-in so real query code runs on fake rows
- Root jest (tests/jest.config.js); from repo root: `node tests/run.js tests/portal --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 4 files: 0 test + 4 support) |
| `helpers/` | Shared fake of the supabase query builder for portal route and service tests → `helpers/CLAUDE.md` |
| `fln*` | 13 files; most used `fln-routes.test.js`: Pins portal-fln.routes over real Express: access gating, /me, plan, events, funnel logging with real fln-access |
| `analytics*` | 9 files; most used `analytics-schools-route.test.js`: Pins the portal_analytics_only access gate, GET /analytics/schools and the analyticsOnly flag on the user payload |
| `bd-o15qnr.8-coach-feedback.test.js` | Pins bd-o15qnr.8 coach v2 round-1 server rules: past-dated visits allowed with no teacher notice, edit and reschedule |
| `coaching*` | 4 files; most used `coaching-report-page.video.test.js`: Pins bd-gzfdu9: /cr report page adds Watch this next card only with a recommendation, else byte-identical to golden |
| `bd-z3cadk-report-extras.test.js` | Pins bd-z3cadk report-extras: portal report shows Last time we asked, journey note, repeat-recording date |
| … | 184 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Portal routes hold no grading logic; the bot decides (tests/portal/no-local-grading-in-portal-routes.test.js:2, bd-2673)
- Gated routes read the SESSION user, never a body id (tests/portal/bd-fmf24g.30-share-route.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/lib/CLAUDE.md`? · `dashboard/middleware/CLAUDE.md`? · `dashboard/middleware/rbac/CLAUDE.md`? · `infrastructure/templates/drafts/README.md`? · `portal/ANDROID.md`? · `tests/CLAUDE.md`?
