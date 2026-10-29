# views — The six analytics tab bodies (Overview, LP, Training, Observations, Coaching, Info)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/analytics/views kg=0e3528b0e8e1 gen=97dfcea08545 overflow=18 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `shared.tsx` — TabProps contract every data tab receives
- `TrainingTab.tsx` — Trainings tab, reads useTrainingLevels
- `TrainingTab.test.tsx` — vitest: `cd portal && npx vitest run src/portal/analytics/views`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `TrainingTab.test.tsx` | Vitest for the Trainings tab: level cards, sector comparison, Primary/Mid-High toggle, partner panels (bd-97x22y.4) |
| `shared.tsx` | TabProps contract every data tab receives plus region-toggle and school-filter helpers (bd-97x22y.2) |
| `trainingLook.ts` | Colour/icon table for Trainings levels and partners, shared by cards, sector rows and bars (bd-97x22y.4) |
| `TrainingBarChart.tsx` | Plain-HTML grouped bar charts for Trainings: sector comparison percent mode and Oxbridge funnel bars (bd-97x22y.4) |
| `TrainingLevelCard.tsx` | Training level card: coloured header, Passed/In Progress/Not Started, progress bar, "What is this level?" (bd-97x22y.4) |
| … | 9 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `shared.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:22:a863f4b3` · `portal/src/portal/analytics/views/CoachingTab.tsx:9:c2c88393` (+4)
- `trainingLook.ts` ← imported by `portal/src/portal/analytics/BandToggle.tsx:3:b3ed49d6` · `portal/src/portal/analytics/views/TrainingLevelCard.tsx:5:dd5af0a9` (+3)
- `TrainingBarChart.tsx` ← imported by `portal/src/portal/analytics/views/TrainingPartners.tsx:6:fed1d38c` · `portal/src/portal/analytics/views/TrainingTab.tsx:8:d8300782`
- `TrainingLevelCard.tsx` ← imported by `portal/src/portal/analytics/views/TrainingPartners.tsx:7:3162efae` · `portal/src/portal/analytics/views/TrainingTab.tsx:9:3162efae`
- … 9 more → `CLAUDE.index.md`

## Never (human)
- Colours come from lpLook.ts / trainingLook.ts / ../ictPalette.ts, never picked inline (lpLook.ts:3-4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/analytics/views/TrainingTab.test.tsx`? (TrainingTab.tsx)

## Related (generated)
- docs: `portal/src/portal/analytics/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
