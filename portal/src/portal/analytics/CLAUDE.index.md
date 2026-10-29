# analytics — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/analytics -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `views/` | The six analytics tab bodies (Overview, LP, Training, Observations, Coaching, Info) → `views/CLAUDE.md` |
| `AnalyticsFrame.tsx` | Page frame for analytics-only accounts: sidebar/phone tab row for six tabs, top bar, Log out (bd-s6qbts.3, bd-97x22y.2) |
| `AnalyticsOnlyGuard.tsx` | Route-table guard: sends analytics-only accounts to schools analytics and everyone else away from it (bd-s6qbts.3) |
| `BandToggle.tsx` | Primary / Mid-High teachers toggle kept in ?band=; useBandParam hook shared by LP and Training tabs (bd-97x22y.3) |
| `BarChart.tsx` | Plain-HTML per-sector bar chart with direct value labels, mirroring the ICT dashboard chart (bd-97x22y.2) |
| `Filters.tsx` | Region chips and period presets/From-To/All-time bar; both choices live in the URL (view.ts) (bd-s6qbts.3) |
| `GroupedBarChart.tsx` | Plain-HTML grouped bar chart (a group per sector, a bar per series, 0-100 axis) for tabs comparing series (bd-97x22y.5) |
| `LpCharts.tsx` | LP Engagement tab's two drawings: RingGauge sector ring and sector-by-subject grouped bars, HTML/SVG (bd-97x22y.3) |
| `LpEngagement.test.tsx` | Vitest for LP Engagement tab: band toggle, Active/Non-Active teachers, sector rings, subject/grade tables, grouped bars |
| `Numbers.tsx` | MetricValue renders one metric: counts with "x of N", scores as % with n, low-n muted, "—" when none (bd-97x22y.2) |
| `SchoolsAnalytics.test.tsx` | Vitest for schools analytics page: six deep-linkable tabs, region/period in URL, sector cards, % on scores only |
| `SchoolsAnalytics.tsx` | Page at /portal/analytics/schools[/tab]: one schools read feeds six tabs for analytics-only accounts (bd-97x22y.2) |
| `SchoolsList.tsx` | Sortable, searchable school list: table on desktop, cards on phone, 25 per page; per-tab columns (bd-s6qbts.3) |
| `Section.tsx` | Section eyebrow layout plus TileGrid and Tile stat tiles shared by every analytics tab (bd-97x22y.2) |
| `SectorCards.tsx` | SectorGrid/SectorCard: one card per region; tapping selects the region and opens its school breakdown (bd-97x22y.2) |
| `copy.ts` | All analytics-page wording keyed by language (English only so far; Urdu is a data addition); analyticsCopy(lang) |
| `entry.test.tsx` | Vitest: analytics-only accounts land on schools analytics from sign-in, "/", open session and reset; others unchanged |
| `fixtures.ts` | Fictional GET /analytics/schools answer for tests/screenshots; rollUp sums region/overview like the server does |
| `format.ts` | Number formatting for analytics: counts, one-decimal scores with n, "—" for none, LOW_N=3 threshold |
| `guard.test.tsx` | Vitest for AnalyticsOnlyGuard redirect rules and for App.tsx wrapping the whole route table (bd-s6qbts.3) |
| `ictPalette.ts` | Single ICT dashboard colour table (ICT) and LOW_SCORE=60 used by every ported analytics view (bd-97x22y.5) |
| `metrics.ts` | The seven per-school metric keys in page order and score-key helpers (teachers, LPs, training, DC/human obs, FICO, HITL) |
| `table.ts` | Sort and search logic for the school table, shared by desktop table and phone cards so they cannot disagree |
| `tabs.ts` | The six schools-analytics tab list and /portal/analytics/schools paths; read by sidebar, route and homeRoute gate |
| `trainingLevelsFixture.ts` | Fictional GET /analytics/training-levels answer on the page fixture's schools, summed like the server (bd-97x22y.4) |
| `view.ts` | Analytics view state in the URL: from/to, period=all, region; preset ranges and presetOf (bd-s6qbts.3) |

## Who reads this (all, generated)
- `AnalyticsFrame.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:11:df94e802`
- `AnalyticsOnlyGuard.tsx` ← imported by `portal/src/App.tsx:24:b9d345c3`
- `BandToggle.tsx` ← imported by `portal/src/portal/analytics/views/LpTab.tsx:7:3036a3fd`
- `Filters.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:13:0b5a09a9`
- `GroupedBarChart.tsx` ← imported by `portal/src/portal/analytics/views/ObservationsTab.tsx:9:04640dce`
- `LpCharts.tsx` ← imported by `portal/src/portal/analytics/views/LpTab.tsx:10:34d17319`
- `Numbers.tsx` ← imported by `portal/src/portal/analytics/SchoolsList.tsx:7:a039d4fc`
- `SchoolsAnalytics.tsx` ← imported by `portal/src/App.tsx:155:06cbb562`
- `SchoolsList.tsx` ← imported by `portal/src/portal/analytics/views/CoachingTab.tsx:5:ac4d1ff0`
- `Section.tsx` ← imported by `portal/src/portal/analytics/views/CoachingTab.tsx:6:6bc4f8d8` · `portal/src/portal/analytics/views/InfoTab.tsx:3:709fc92a` · `portal/src/portal/analytics/views/LpTab.tsx:11:709fc92a` · `portal/src/portal/analytics/views/ObservationsTab.tsx:11:6bc4f8d8` (+2: `python3 kg/kg.py who-reads Section.tsx`)
- `SectorCards.tsx` ← imported by `portal/src/portal/analytics/views/CoachingTab.tsx:7:19a72be4` · `portal/src/portal/analytics/views/LpTab.tsx:12:19a72be4` · `portal/src/portal/analytics/views/ObservationsTab.tsx:12:19a72be4` · `portal/src/portal/analytics/views/TrainingTab.tsx:7:85c16d8b`
- `copy.ts` ← imported by `portal/src/portal/analytics/AnalyticsFrame.tsx:7:7ee6ef6c` · `portal/src/portal/analytics/Filters.tsx:6:a34c9330` · `portal/src/portal/analytics/LpCharts.tsx:1:7ee6ef6c` · `portal/src/portal/analytics/Numbers.tsx:3:7ee6ef6c` (+12: `python3 kg/kg.py who-reads copy.ts`)
- `fixtures.ts` ← imported by `portal/src/portal/analytics/trainingLevelsFixture.ts:13:9d8d2641`
- `format.ts` ← imported by `portal/src/portal/analytics/Filters.tsx:7:53dc429a` · `portal/src/portal/analytics/LpCharts.tsx:2:7f63e54b` · `portal/src/portal/analytics/Numbers.tsx:4:3d63258b` · `portal/src/portal/analytics/SchoolsAnalytics.tsx:14:0b0765f5` (+9: `python3 kg/kg.py who-reads format.ts`)
- `ictPalette.ts` ← imported by `portal/src/portal/analytics/views/CoachingTab.tsx:4:0b24ac53` · `portal/src/portal/analytics/views/ObservationsTab.tsx:10:56dc3625`
- `metrics.ts` ← imported by `portal/src/portal/analytics/Numbers.tsx:5:ba607df1` · `portal/src/portal/analytics/SchoolsList.tsx:6:75ab2a4e` · `portal/src/portal/analytics/table.ts:3:97921ec8`
- `table.ts` ← imported by `portal/src/portal/analytics/SchoolsList.tsx:8:c9884707` · `portal/src/portal/analytics/views/shared.tsx:6:d0c247b3`
- `tabs.ts` ← imported by `portal/src/portal/lib/homeRoute.ts:2:87fbe82c` · `portal/src/portal/analytics/AnalyticsFrame.tsx:8:d0b9178a` · `portal/src/portal/analytics/SchoolsAnalytics.tsx:15:3df812fe` · `portal/src/portal/analytics/copy.ts:15:1b77bbbd`
- `view.ts` ← imported by `portal/src/portal/analytics/Filters.tsx:8:52a9b446` · `portal/src/portal/analytics/SchoolsAnalytics.tsx:16:c147f7a0` · `portal/src/portal/analytics/views/CoachingTab.tsx:8:96daf8b2` · `portal/src/portal/analytics/views/LpTab.tsx:13:eb419b81` (+1: `python3 kg/kg.py who-reads view.ts`)

## Tests (all, generated)
- `AnalyticsOnlyGuard.tsx` ← `portal/src/portal/analytics/guard.test.tsx`
- `SchoolsAnalytics.tsx` ← `portal/src/portal/analytics/LpEngagement.test.tsx` · `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` · `portal/src/portal/analytics/views/TrainingTab.test.tsx`
- `SchoolsList.tsx` ← `portal/src/portal/analytics/SchoolsAnalytics.test.tsx`
- `copy.ts` ← `portal/src/portal/analytics/SchoolsAnalytics.test.tsx`
- `fixtures.ts` ← `portal/src/portal/analytics/LpEngagement.test.tsx` · `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` · `portal/src/portal/analytics/views/TrainingTab.test.tsx`
- `table.ts` ← `portal/src/portal/analytics/SchoolsAnalytics.test.tsx`
- `tabs.ts` ← `portal/src/portal/lib/homeRoute.test.ts`
- `trainingLevelsFixture.ts` ← `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` · `portal/src/portal/analytics/views/TrainingTab.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
