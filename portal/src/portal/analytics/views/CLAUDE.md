# views — The six analytics tab bodies (Overview, LP, Training, Observations, Coaching, Info)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/analytics/views kg=42c73866b2b2 gen=73a4f6837787 overflow=21 rendered=2026-11-20 kg.py=1.1.0 -->

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
| `useObservers.ts` | (unmapped) |
| `ObserversView.tsx` | (unmapped) |
| `TrainingBarChart.tsx` | Plain-HTML grouped bar charts for Trainings: sector comparison percent mode and Oxbridge funnel bars (bd-97x22y.4) |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `shared.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:24:a863f4b3` · `portal/src/portal/analytics/views/CoachingTab.tsx:9:c2c88393` (+5)
- `trainingLook.ts` ← imported by `portal/src/portal/analytics/BandToggle.tsx:3:b3ed49d6` · `portal/src/portal/analytics/views/TrainingLevelCard.tsx:5:dd5af0a9` (+3)
- `useObservers.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:23:54bfef6f` · `portal/src/portal/analytics/views/ObserversView.tsx:6:b373eb07` (+1)
- `ObserversView.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:22:f797d6be` · `portal/src/portal/analytics/views/OverviewTab.tsx:5:2ebc1f81`
- … 11 more → `CLAUDE.index.md`

## Never (human)
- Colours come from lpLook.ts / trainingLook.ts / ../ictPalette.ts, never picked inline (lpLook.ts:3-4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/analytics/views/TrainingTab.test.tsx`? (TrainingTab.tsx)

## Related (generated)
- docs: `portal/src/portal/analytics/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
