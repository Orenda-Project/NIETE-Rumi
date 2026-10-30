# card — School card: per-school and per-teacher coach views behind a switch
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/card kg=494175621b96 gen=93e984380668 overflow=36 rendered=2026-10-30 kg.py=1.1.0 -->

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
| `api.ts` | School card reads GET /api/portal/coach/... (404 when switch off or not her school); read only |
| … | 19 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/teacher/copyRegistry.ts:9:1838e6da` · `portal/src/portal/coach/card/DaysUsedPage.tsx:7:b8c88189` (+11)
- `frame.tsx` ← imported by `portal/src/portal/coach/pages/CoachPeople.tsx:13:7a39566b` · `portal/src/portal/coach/pages/CoachSchool.tsx:13:7a39566b` (+11)
- `types.ts` ← imported by `portal/src/portal/coach/card/DaysUsedPage.tsx:12:a9641473` · `portal/src/portal/coach/card/FeatureGridPage.tsx:12:e56fb790` (+11)
- `period.ts` ← imported by `portal/src/portal/coach/card/DaysUsedPage.tsx:10:b405e2b8` · `portal/src/portal/coach/card/FeatureGridPage.tsx:9:7dd7d4b5` (+8)
- … 15 more → `CLAUDE.index.md`

## Never (human)
- Read only: the card's API never writes (api.ts:6)
- Every number is the server's; unloaded shows a dash, never 0 (types.ts:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/card/period.test.ts` (copy.ts, period.ts, types.ts)
- `portal/src/portal/coach/card/switchOff.test.tsx` (fixtures.testdata.ts, harness.testdata.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
