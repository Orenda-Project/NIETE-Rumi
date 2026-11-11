# coaching — Teacher Digital Coaching: hub, one-screen observation, report, All DC observations
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/coaching kg=bd309f41e826 gen=0e2876deb44c overflow=74 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `NewObservation.tsx` — the one screen at /coaching/new; `ReportPage.tsx` — shared report (also coach visits)
- `routes.tsx` and `paths.ts` — page map; `draft.ts` holds recording, plan and photos in memory
- `CoachingPages.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/coaching`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words for all Digital Coaching screens (machine-drafted Urdu), registered as COPY_ENTRY |
| `paths.ts` | Path builders for Coaching pages: home, send, new (one screen), all, and one lesson's report |
| `coaching.ur.test.tsx` | Renders Digital Coaching hub, one screen, send, report and All DC observations in Urdu (bd-fmf24g.13.2) |
| … | 39 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/insights/player/FullRecordingLink.tsx:4:dd128a06` · `portal/src/portal/coach/insights/player/MomentPlayer.tsx:4:dd128a06` (+14)
- `paths.ts` ← imported by `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:21:d1a155d5` · `portal/src/portal/teacher/home/chips.ts:3:87d7f35f` (+10)
- … 15 more → `CLAUDE.index.md`

## Never (human)
- A failed history read throws; never show an empty list as 'no lessons' (api.ts:12)
- Submit says 'No internet' only when offline; other failures name the failed part (submitFailure.test.tsx, bd-bmc9a0.1)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` (CoachingAll.tsx, CoachingHome.tsx, NewObservation.tsx, ReportPage.tsx, SendPage.tsx, api.ts, copy.ts, draft.ts, paths.ts, report.ts)
- `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` (CoachingHome.tsx, NewObservation.tsx, SendPage.tsx, copy.ts, draft.ts, paths.ts, routes.tsx)
- … 24 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/coaching/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/share/CLAUDE.md`?
