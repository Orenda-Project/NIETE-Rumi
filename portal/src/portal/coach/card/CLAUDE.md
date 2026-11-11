# card — School card: per-school and per-teacher coach views behind a switch
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/card kg=b4070a96cf24 gen=14ecfb654abd overflow=48 rendered=2026-11-05 kg.py=1.1.0 -->

## Entry points
- `SchoolCardPage.tsx` — the school card with period chips and feature tiles
- `api.ts` — read-only GET /api/portal/coach/... (dashboard coach-school-card.routes.js)
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/card`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words for every School card screen, typed so missing Urdu fails the build |
| `types.ts` | Shapes of the School card API answers behind portal_coach_school_card |
| `frame.tsx` | School card plumbing: useCardSwitch, CardOnly gate and a period-aware loader |
| `period.ts` | School card period (Today, This week, This month) in the ?period= address plus label helpers |
| `parts.tsx` | School card pieces: period chips, bars, activity tiles, teacher grid, score chart, sparkline |
| … | 25 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachPickTeacher.tsx:7:bb80576a` · `portal/src/portal/teacher/copyRegistry.ts:13:1838e6da` (+14)
- `types.ts` ← imported by `portal/src/portal/coach/card/DaysUsedPage.tsx:12:a9641473` · `portal/src/portal/coach/card/FeatureGridPage.tsx:15:901d8c66` (+13)
- `frame.tsx` ← imported by `portal/src/portal/coach/pages/CoachPeople.tsx:13:7a39566b` · `portal/src/portal/coach/pages/CoachSchool.tsx:13:7a39566b` (+11)
- `parts.tsx` ← imported by `portal/src/portal/coach/card/DaysUsedPage.tsx:11:ae8e732d` · `portal/src/portal/coach/card/FeatureGridPage.tsx:9:afb846b0` (+8)
- … 17 more → `CLAUDE.index.md`

## Never (human)
- Read only: the card's API never writes (api.ts:6)
- Every number is the server's; unloaded shows a dash, never 0 (types.ts:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/card/schoolView.test.tsx`? (fixtures.testdata.ts, harness.testdata.tsx, schoolView.tsx, types.ts)
- `portal/src/portal/coach/card/period.test.ts` (copy.ts, period.ts, types.ts)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
