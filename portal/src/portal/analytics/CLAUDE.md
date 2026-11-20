# analytics — Schools analytics page (six tabs) for FDE/AEO analytics-only accounts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/analytics kg=03e0132d8f93 gen=ac13ff883d70 overflow=45 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `SchoolsAnalytics.tsx` — page: one schools read feeds six tabs; view state in URL (view.ts)
- `tabs.ts` — tab list read by sidebar, route and homeRoute gate
- Tests (`*.test.tsx` here and in views/): vitest, run `cd portal && npx vitest run src/portal/analytics`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `journey/` | (no description yet) → `journey/CLAUDE.md` |
| `views/` | The six analytics tab bodies (Overview, LP, Training, Observations, Coaching, Info) → `views/CLAUDE.md` |
| `copy.ts` | All analytics-page wording keyed by language (English only so far; Urdu is a data addition); analyticsCopy(lang) |
| `format.ts` | Number formatting for analytics: counts, one-decimal scores with n, "—" for none, LOW_N=3 threshold |
| `MoawinView.test.tsx` | (unmapped) |
| … | 24 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/analytics/AnalyticsFrame.tsx:7:7ee6ef6c` · `portal/src/portal/analytics/Filters.tsx:6:a34c9330` (+15)
- `format.ts` ← imported by `portal/src/portal/analytics/Filters.tsx:7:53dc429a` · `portal/src/portal/analytics/LpCharts.tsx:2:7f63e54b` (+12)
- `Section.tsx` ← imported by `portal/src/portal/analytics/journey/JourneySection.tsx:4:709fc92a` · `portal/src/portal/analytics/views/CoachingTab.tsx:6:6bc4f8d8` (+6)
- … 16 more → `CLAUDE.index.md`

## Never (human)
- Keep tabs.ts import-free: lib/homeRoute imports it (analytics/tabs.ts:6)
- Plain HTML charts, no chart library: values stay real text the tests read (analytics/BarChart.tsx:8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` (SchoolsAnalytics.tsx, SchoolsList.tsx, copy.ts, fixtures.ts, table.ts, trainingLevelsFixture.ts)
- `portal/src/portal/analytics/MoawinView.test.tsx` (SchoolsAnalytics.tsx, copy.ts, fixtures.ts)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
