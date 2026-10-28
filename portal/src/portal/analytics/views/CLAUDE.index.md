# views — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/analytics/views -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `CoachingTab.tsx` | Coaching tab ported from the ICT dashboard: total coaches/visits, sector cards, school visits; own read (bd-97x22y.5) |
| `InfoTab.tsx` | Information tab: static "how these numbers are worked out" cards grouped like the tabs (bd-97x22y.2) |
| `LpTab.tsx` | LP Engagement tab: overview, Active/Non-Active teachers, sector rings, subject/grade tables, grouped bars (bd-97x22y.3) |
| `ObservationsTab.tsx` | Observations tab: Human/Digital Coach toggle, summary, FICO score cards (amber under 60), sector view (bd-97x22y.5) |
| `OverviewTab.tsx` | Overview tab: schools, teachers, snapshot, scores and coaching sections; coaching has its own read (bd-97x22y.2) |
| `TrainingBarChart.tsx` | Plain-HTML grouped bar charts for Trainings: sector comparison percent mode and Oxbridge funnel bars (bd-97x22y.4) |
| `TrainingLevelCard.tsx` | Training level card: coloured header, Passed/In Progress/Not Started, progress bar, "What is this level?" (bd-97x22y.4) |
| `TrainingPartners.tsx` | Mid/High Training Partners panels (Oxbridge, Beaconhouse, ISAPS) opened from three partner buttons (bd-97x22y.4) |
| `TrainingTab.test.tsx` | Vitest for the Trainings tab: level cards, sector comparison, Primary/Mid-High toggle, partner panels (bd-97x22y.4) |
| `TrainingTab.tsx` | Trainings tab: RDF training-card numbers (passed = certificate) by level, sector, school; uses useTrainingLevels |
| `lpLook.ts` | Colour/icon table for the LP Engagement tab, one source for its cards, table cells and bars (bd-97x22y.3) |
| `shared.tsx` | TabProps contract every data tab receives plus region-toggle and school-filter helpers (bd-97x22y.2) |
| `trainingLook.ts` | Colour/icon table for Trainings levels and partners, shared by cards, sector rows and bars (bd-97x22y.4) |
| `useTrainingLevels.ts` | Hook: GET /analytics/training-levels for region and band, only while the tab shows; keeps old numbers while refetching |

## Who reads this (all, generated)
- `CoachingTab.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:17:e77b1ed5`
- `InfoTab.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:18:a6ad8d7a`
- `LpTab.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:19:b5afc344`
- `ObservationsTab.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:20:08e89ad2`
- `OverviewTab.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:21:b4d6e265`
- `TrainingBarChart.tsx` ← imported by `portal/src/portal/analytics/views/TrainingPartners.tsx:6:fed1d38c` · `portal/src/portal/analytics/views/TrainingTab.tsx:8:d8300782`
- `TrainingLevelCard.tsx` ← imported by `portal/src/portal/analytics/views/TrainingPartners.tsx:7:3162efae` · `portal/src/portal/analytics/views/TrainingTab.tsx:9:3162efae`
- `TrainingPartners.tsx` ← imported by `portal/src/portal/analytics/views/TrainingTab.tsx:10:79a07c96`
- `TrainingTab.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:23:e2112730`
- `lpLook.ts` ← imported by `portal/src/portal/analytics/views/LpTab.tsx:14:bd63e4a1`
- `shared.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:22:a863f4b3` · `portal/src/portal/analytics/views/CoachingTab.tsx:9:c2c88393` · `portal/src/portal/analytics/views/LpTab.tsx:15:d722a12e` · `portal/src/portal/analytics/views/ObservationsTab.tsx:14:d722a12e` (+2: `python3 kg/kg.py who-reads shared.tsx`)
- `trainingLook.ts` ← imported by `portal/src/portal/analytics/BandToggle.tsx:3:b3ed49d6` · `portal/src/portal/analytics/views/TrainingLevelCard.tsx:5:dd5af0a9` · `portal/src/portal/analytics/views/TrainingPartners.tsx:10:f1b961e9` · `portal/src/portal/analytics/views/TrainingTab.tsx:11:227f4384` (+1: `python3 kg/kg.py who-reads trainingLook.ts`)
- `useTrainingLevels.ts` ← imported by `portal/src/portal/analytics/views/TrainingTab.tsx:13:9189a2dd`

## Tests (all, generated)
- `TrainingTab.tsx` ← `portal/src/portal/analytics/views/TrainingTab.test.tsx`?

## Related (all, generated)
- docs: `portal/src/portal/analytics/CLAUDE.index.md`? · `portal/src/portal/analytics/CLAUDE.md`? · `portal/src/portal/analytics/views/CLAUDE.index.md`? · `portal/src/portal/analytics/views/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.index.md`? · `portal/src/portal/services/CLAUDE.md`?
