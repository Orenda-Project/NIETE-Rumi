# home — New-UI teacher Home: date-range 'what you did' tiles and their lists

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/home kg=f778fb4a30ec gen=37addb5658e9 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `NewHome.tsx` — band, date range and five metric tiles
- `progressApi.ts` — GET /api/portal/progress[/:metric] client; tests: `cd portal && npx vitest run src/portal/newui/home` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `progressApi.ts` | bd-5rz1v.17: client for GET /api/portal/progress and /progress/:metric (dashboard progress.service) |
| `HomeList.test.tsx` | bd-5rz1v.17: Home tile lists (Lesson plans used, Coaching and observations) from GET /api/portal/progress/:metric |
| `homeNav.test.tsx` | bd-5rz1v.17: Home's band avatar opens the shared account sheet; phone top strip hidden on Home |
| `NewHome.test.tsx` | bd-5rz1v.17: new Home band, date range default This month, five tiles with no rating up front |
| `CLAUDE.md` | (unmapped) |
| `HomeList.tsx` | bd-5rz1v.17: inner list page behind a Home tile, fed by /api/portal/progress/:metric with date range |
| `NewHome.tsx` | New-UI teacher Home: "what you did" band with avatar, date range and five metric tiles |

## Who reads this (generated)
- `progressApi.ts` ← imported by `portal/src/portal/newui/coaching/PickStage.tsx:3:4767aea7` · `portal/src/portal/newui/coaching/PlanSheet.tsx:5:4767aea7` (+5)
- `HomeList.tsx` ← imported by `portal/src/portal/pages/PortalHomeList.tsx:6:ca40c029`
- `NewHome.tsx` ← imported by `portal/src/portal/pages/PortalDashboard.tsx:11:abebd72f`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/tests/readers.test.tsx` (HomeList.tsx)
- `portal/src/portal/newui/home/HomeList.test.tsx` (HomeList.tsx)
- `portal/src/portal/newui/home/NewHome.test.tsx` (NewHome.tsx)
- `portal/src/portal/teacher/analytics/model.test.ts` (progressApi.ts)

## Related (generated)
- docs: `portal/src/portal/fln/tests/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/home/CLAUDE.md`? · `portal/src/portal/teacher/analytics/CLAUDE.index.md`? (+1)
