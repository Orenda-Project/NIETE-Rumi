# observations — Teacher Observations: next coach visit, visits in progress, visit reports
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/observations kg=bcffa22a101d gen=6d7fe7390671 overflow=8 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `ObservationsHome.tsx` — page; `api.ts` — GET /teacher/visits and coach-visit sessions
- `routes.tsx` — /portal/teacher/observations; report page reuses coaching/ReportPage
- `Observations.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/observations`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `observations.ur.test.tsx` | Renders Observations main page and a visit report in Urdu with the bot's Urdu band words (bd-fmf24g.13.2) |
| `paths.ts` | Path builders for Observations: OBS_HOME and the report path reusing the shared coaching ReportPage |
| `Observations.test.tsx` | Pins Observations page: next visit, in-progress stage only, no visit state, reports and visit report (bd-fmf24g.4) |
| … | 7 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `paths.ts` ← imported by `portal/src/portal/teacher/home/chips.ts:4:614029b8` · `portal/src/portal/teacher/home/look/cardWords.ts:4:55f11086` (+3)
- `ObservationsHome.tsx` ← imported by `portal/src/portal/teacher/observations/routes.tsx:6:af920adc`
- `api.ts` ← imported by `portal/src/portal/teacher/observations/ObservationsHome.tsx:16:f775a727`
- `copy.ts` ← imported by `portal/src/portal/teacher/observations/ObservationsHome.tsx:17:376d03b0`

## Never (human)
- A failed read throws: 'no visit' and 'no reports' are real answers, not errors (api.ts:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/observations/observations.ur.test.tsx` (ObservationsHome.tsx, api.ts, copy.ts, paths.ts, routes.tsx)
- `portal/src/portal/teacher/observations/Observations.test.tsx` (ObservationsHome.tsx, copy.ts, paths.ts, routes.tsx)
- … 1 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/lessons/CLAUDE.index.md`? · `portal/src/portal/teacher/observations/CLAUDE.index.md`? (+1)
