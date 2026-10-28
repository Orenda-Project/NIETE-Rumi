# analytics — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/analytics -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AnalyticsPage.test.tsx` | Tests AnalyticsPage: /progress and /my-analytics tiles, default range, Back to More (bd-fmf24g.8) |
| `AnalyticsPage.tsx` | Teacher Analytics page (More > Analytics): date range, Activity and Observation tiles, band chart, areas, remarks |
| `BandChart.tsx` | Rating-over-time chart on five band rows, a thin wrapper over the kit's TrendChart in band-rows mode |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `SchoolView.test.tsx` | Tests the principal's Analytics: My school | Me tabs, server-owned school (no school param sent), teacher row opens one |
| `SchoolView.tsx` | Principal's My school view and one-teacher page, from GET /leader/school-analytics and /leader/teachers (bd-fmf24g.27) |
| `analytics.ur.test.tsx` | Renders Analytics in Urdu and asserts headings, tiles, band rows and chips use the bot's Urdu band names (bd-fmf24g.13) |
| `checks.test.tsx` | Style and copy guard for Analytics: logical start/end only, motion-safe motion, copy.ts words, 56px targets |
| `copy.ts` | English and Urdu words for the teacher Analytics page (ANALYTICS_V2_COPY, COPY_ENTRY registered for Urdu checks) |
| `model.test.ts` | Tests model.ts: activity/observation KPIs vs the previous period, bands not numbers, missing count stays empty not 0 |
| `model.ts` | Pure Analytics model: KPIs with change vs previous period, band rows, trends, area rows from /progress and /my-analytics |
| `paths.ts` | Path constants for Analytics: ANALYTICS_HOME and the one-teacher analytics path used by the principal view |
| `routes.tsx` | Registers the lazy Analytics page(s) under /portal/teacher/analytics and the principal one-teacher route via TeacherGate |
| `school.ts` | Pure model for the principal's views: school KPIs and teacher rows from /leader/school-analytics and /leader/teachers |
| `sections.tsx` | Shared Analytics sections used by every profile's view: tiles, rating, areas, attendance and remarks cards |

## Who reads this (all, generated)
- `AnalyticsPage.tsx` ← imported by `portal/src/portal/teacher/analytics/routes.tsx:6:1830dc8e`
- `BandChart.tsx` ← imported by `portal/src/portal/teacher/analytics/sections.tsx:6:363546a2`
- `SchoolView.tsx` ← imported by `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:15:e08819ef` · `portal/src/portal/teacher/analytics/routes.tsx:7:6cb8dab7`
- `copy.ts` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:6:ee0fbe19` · `portal/src/portal/coach/analytics/model.ts:4:27fcf88e` · `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:24:cdce1382` · `portal/src/portal/teacher/analytics/SchoolView.tsx:13:cdce1382` (+3: `python3 kg/kg.py who-reads copy.ts`)
- `model.ts` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:8:c1135b8e` · `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:27:74d4b72c` · `portal/src/portal/teacher/analytics/BandChart.tsx:2:66cda7d3` · `portal/src/portal/teacher/analytics/SchoolView.tsx:15:bb66a9a3` (+1: `python3 kg/kg.py who-reads model.ts`)
- `paths.ts` ← imported by `portal/src/portal/teacher/analytics/SchoolView.tsx:14:d1cdb2f6` · `portal/src/portal/teacher/analytics/routes.tsx:2:ac2d7d9e` · `portal/src/portal/teacher/analytics/school.ts:4:d1cdb2f6`
- `school.ts` ← imported by `portal/src/portal/teacher/analytics/SchoolView.tsx:16:68492cae`
- `sections.tsx` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:7:6c73a229` · `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:23:f079900c` · `portal/src/portal/teacher/analytics/SchoolView.tsx:17:9e5a81b0`

## Tests (all, generated)
- `AnalyticsPage.tsx` ← `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx`?
- `SchoolView.tsx` ← `portal/src/portal/teacher/analytics/SchoolView.test.tsx`?
- `copy.ts` ← `portal/src/portal/coach/analytics/CoachAnalytics.test.tsx` · `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx` · `portal/src/portal/teacher/analytics/SchoolView.test.tsx` · `portal/src/portal/teacher/analytics/analytics.ur.test.tsx` · `portal/src/portal/teacher/analytics/checks.test.tsx` · `portal/src/portal/teacher/analytics/model.test.ts`
- `model.ts` ← `portal/src/portal/teacher/analytics/model.test.ts`
- `paths.ts` ← `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx` · `portal/src/portal/teacher/analytics/SchoolView.test.tsx` · `portal/src/portal/teacher/analytics/analytics.ur.test.tsx` · `portal/src/portal/teacher/analytics/checks.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx` · `portal/src/portal/teacher/analytics/SchoolView.test.tsx` · `portal/src/portal/teacher/analytics/analytics.ur.test.tsx` · `portal/src/portal/teacher/analytics/checks.test.tsx`
- `school.ts` ← `portal/src/portal/teacher/analytics/SchoolView.test.tsx`
- `sections.tsx` ← `portal/src/portal/coach/disagreements/sections.test.ts`?

## Related (all, generated)
- docs: `portal/src/lib/CLAUDE.index.md`? · `portal/src/portal/coach/analytics/CLAUDE.md`? · `portal/src/portal/coach/disagreements/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/home/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/analytics/CLAUDE.index.md`? · `portal/src/portal/teacher/analytics/CLAUDE.md`? · `portal/src/portal/teacher/coaching/CLAUDE.index.md`? · `portal/src/portal/teacher/lessons/CLAUDE.index.md`? · `portal/src/portal/types/CLAUDE.index.md`? · `portal/src/portal/types/CLAUDE.md`?
