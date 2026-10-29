# card — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/card -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CoachLanding.tsx` | Landing at /portal/coach: slim Coach Home when the School card switch is on, else the old coach Home |
| `CoachingRedirect.tsx` | (unmapped) |
| `FeatureGridPage.tsx` | School card sub-page: one feature by teacher as a day/week grid with school totals row |
| `HerItemsPage.tsx` | Teacher's item list for one feature in the period: DC observations, coach visits, plans, papers, training |
| `SchoolCardPage.tsx` | A school's School card: period chips, four feature tiles, teachers with Contribution %, Manage group |
| `ScoresByTeacher.tsx` | (unmapped) |
| `SessionReportPage.tsx` | One DC report as the coach sees it: score, practices on the framework scale, plan steps, reflection |
| `SlimHome.tsx` | Slim Coach Home with the School card on: NIETE band plus Training Library and My schools tiles |
| `TeacherCardPage.tsx` | A teacher's card for the period: feature tiles, score chart and coaching reports for the coach |
| `TeacherScoresPage.tsx` | (unmapped) |
| `api.ts` | School card reads GET /api/portal/coach/... (404 when switch off or not her school); read only |
| `copy.test.ts` | Pins School card copy: Urdu complete, label-only values, ontology words, dash for unloaded numbers |
| `copy.ts` | English and Urdu words for every School card screen, typed so missing Urdu fails the build |
| `fixtures.testdata.ts` | Invented School card API answers (week, month, today, items, reports) used only by card tests |
| `frame.tsx` | School card plumbing: useCardSwitch, CardOnly gate and a period-aware loader |
| `harness.testdata.tsx` | School card tests' app harness: real guard and pages with only axios mocked |
| `parts.tsx` | School card pieces: period chips, bars, activity tiles, teacher grid, score chart, sparkline |
| `period.test.ts` | Pins period address handling, bar labels, per-day lines and days-still-ahead wording |
| `period.ts` | School card period (Today, This week, This month) in the ?period= address plus label helpers |
| `scores.tsx` | (unmapped) |
| `switchOff.test.tsx` | Pins that with the School card switch off the coach app is unchanged and card routes go nowhere |
| `switchOn.test.tsx` | Pins the School card with the switch on: slim Home, menu, period chips, teachers, observations |
| `types.ts` | Shapes of the School card API answers behind portal_coach_school_card |
| `useSchoolCard.ts` | Hook reading features.schoolCard from /config (app_settings portal_coach_school_card), fail-closed |

## Who reads this (all, generated)
- `CoachLanding.tsx` ← imported by `portal/src/App.tsx:102:bfd131cf` · `portal/src/portal/coach/card/harness.testdata.tsx:43:4b3728bb`
- `CoachingRedirect.tsx` ← imported by `portal/src/App.tsx:109:fc467a13` · `portal/src/portal/coach/card/harness.testdata.tsx:44:e793bea8`
- `FeatureGridPage.tsx` ← imported by `portal/src/App.tsx:104:e8747d1d` · `portal/src/portal/coach/card/harness.testdata.tsx:44:e793bea8`
- `HerItemsPage.tsx` ← imported by `portal/src/App.tsx:105:a8d6ca26` · `portal/src/portal/coach/card/harness.testdata.tsx:44:e793bea8`
- `SchoolCardPage.tsx` ← imported by `portal/src/portal/coach/pages/CoachSchool.tsx:14:7531a308`
- `ScoresByTeacher.tsx` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:11:03722dc7`
- `SessionReportPage.tsx` ← imported by `portal/src/App.tsx:110:43b7402d` · `portal/src/portal/coach/card/harness.testdata.tsx:45:a2b616a8`
- `SlimHome.tsx` ← imported by `portal/src/portal/coach/card/CoachLanding.tsx:5:2ae79de8`
- `TeacherCardPage.tsx` ← imported by `portal/src/portal/coach/pages/CoachTeacher.tsx:12:fc6c6141`
- `TeacherScoresPage.tsx` ← imported by `portal/src/App.tsx:108:03da9cfd` · `portal/src/portal/coach/card/harness.testdata.tsx:44:e793bea8`
- `api.ts` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:7:b7215193` · `portal/src/portal/coach/card/HerItemsPage.tsx:9:b7215193` · `portal/src/portal/coach/card/SchoolCardPage.tsx:12:b7215193` · `portal/src/portal/coach/card/ScoresByTeacher.tsx:7:b7215193` (+3: `python3 kg/kg.py who-reads api.ts`)
- `copy.ts` ← imported by `portal/src/portal/teacher/copyRegistry.ts:9:1838e6da` · `portal/src/portal/coach/card/FeatureGridPage.tsx:6:b8c88189` · `portal/src/portal/coach/card/HerItemsPage.tsx:8:b8c88189` · `portal/src/portal/coach/card/SchoolCardPage.tsx:11:b8c88189` (+8: `python3 kg/kg.py who-reads copy.ts`)
- `frame.tsx` ← imported by `portal/src/portal/coach/pages/CoachPeople.tsx:13:7a39566b` · `portal/src/portal/coach/pages/CoachSchool.tsx:13:7a39566b` · `portal/src/portal/coach/pages/CoachTeacher.tsx:11:7a39566b` · `portal/src/portal/coach/card/CoachLanding.tsx:4:d0df9fcb` (+8: `python3 kg/kg.py who-reads frame.tsx`)
- `parts.tsx` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:10:34f9089b` · `portal/src/portal/coach/card/HerItemsPage.tsx:12:46ad6c60` · `portal/src/portal/coach/card/SchoolCardPage.tsx:15:dee7fa4a` · `portal/src/portal/coach/card/ScoresByTeacher.tsx:10:46ad6c60` (+4: `python3 kg/kg.py who-reads parts.tsx`)
- `period.ts` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:9:7dd7d4b5` · `portal/src/portal/coach/card/HerItemsPage.tsx:11:b405e2b8` · `portal/src/portal/coach/card/SchoolCardPage.tsx:14:1c2d1823` · `portal/src/portal/coach/card/ScoresByTeacher.tsx:9:ee03a0a6` (+5: `python3 kg/kg.py who-reads period.ts`)
- `scores.tsx` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:16:517fecc8` · `portal/src/portal/coach/card/ScoresByTeacher.tsx:11:4b225b0b` · `portal/src/portal/coach/card/TeacherCardPage.tsx:15:973be883` · `portal/src/portal/coach/card/TeacherScoresPage.tsx:13:41c06eb2`
- `types.ts` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:12:e56fb790` · `portal/src/portal/coach/card/HerItemsPage.tsx:13:0e38cc42` · `portal/src/portal/coach/card/SchoolCardPage.tsx:18:92603022` · `portal/src/portal/coach/card/ScoresByTeacher.tsx:12:dbc2db2a` (+8: `python3 kg/kg.py who-reads types.ts`)
- `useSchoolCard.ts` ← imported by `portal/src/portal/coach/training/CoachAppGuard.tsx:11:949d6987` · `portal/src/portal/components/PortalNavigation.tsx:16:c3e7bcc1` · `portal/src/portal/coach/card/frame.tsx:7:f661d3b6` · `portal/src/portal/coach/card/harness.testdata.tsx:96:57b8a664`

## Tests (all, generated)
- `copy.ts` ← `portal/src/portal/coach/card/copy.test.ts` · `portal/src/portal/coach/card/period.test.ts`
- `fixtures.testdata.ts` ← `portal/src/portal/coach/card/switchOff.test.tsx` · `portal/src/portal/coach/card/switchOn.test.tsx`
- `harness.testdata.tsx` ← `portal/src/portal/coach/card/switchOff.test.tsx` · `portal/src/portal/coach/card/switchOn.test.tsx`
- `period.ts` ← `portal/src/portal/coach/card/period.test.ts`
- `types.ts` ← `portal/src/portal/coach/card/period.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
