# training — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/training -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CoachAppGuard.dual.test.tsx` | Pins where a user with both coachip and coachipRm lands, by coachesHere (fix-r5 s5) |
| `CoachAppGuard.loop.test.tsx` | Pins that a v2 coach is never bounced between guard and CoachGate when the flag flips |
| `CoachAppGuard.rm.test.tsx` | Pins that an RM on coach v2 lands on /portal/rm; dual role keeps This week (fix-r5 s2 item 9) |
| `CoachAppGuard.test.tsx` | Pins CoachAppGuard with switches off: v2 coach redirects, others untouched, child test on/off |
| `CoachAppGuard.tsx` | Route guard sending a v2 coach from any not-ready page to the first ready page (bd-s42dye.2) |
| `LibraryPages.tsx` | Coach Training Library pages: home, provider, module and exam preview, read only |
| `appReady.fullApp.test.ts` | (unmapped) |
| `appReady.schoolCard.test.ts` | Pins School card switch in the ready list: slim Home first, others stay shut |
| `appReady.test.ts` | Pins the COACH_APP_READY allow-list and how enabling a feature opens its pages (bd-s42dye.2) |
| `appReady.ts` | Allow-list of coach app v2 features, menu, landing and path-ready rules (bd-s42dye.2) |
| `copy.ts` | English and Urdu words of the coach Training Library |
| `library.test.tsx` | Pins the coach Training Library on mocked endpoints: GET only, no locks, previews read only |
| `libraryApi.ts` | Read-only hooks for the four library endpoints (bd-s42dye.1); no writes or attempts |
| `nav.test.tsx` | Pins coach menu on ready features: Training Library, Lesson Plans, My schools, More |
| `redesign.test.tsx` | Pins that the Training Library uses the teacher kit's band, tiles, rows and question visuals (bd-s42dye.6) |
| `routes.test.ts` | Pins that the Training Library routes sit under /portal/coach and the guard wraps them |
| `useCoachFullApp.ts` | (unmapped) |

## Who reads this (all, generated)
- `CoachAppGuard.tsx` ← imported by `portal/src/App.tsx:25:dd40c5c7` · `portal/src/portal/coach/card/harness.testdata.tsx:46:4b3728bb`
- `LibraryPages.tsx` ← imported by `portal/src/App.tsx:162:5c536921`
- `appReady.ts` ← imported by `portal/src/portal/coach/insights/InsightsGate.tsx:6:f4172066` · `portal/src/portal/coach/insights/paths.ts:1:72012f5c` · `portal/src/portal/coach/pages/CoachPeople.tsx:12:b015a408` · `portal/src/portal/components/PortalNavigation.tsx:13:22bceb08` (+4: `python3 kg/kg.py who-reads appReady.ts`)
- `copy.ts` ← imported by `portal/src/portal/teacher/copyRegistry.ts:9:3ff9d825` · `portal/src/portal/coach/training/LibraryPages.tsx:21:f965f797`
- `libraryApi.ts` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:11:fd553941` · `portal/src/portal/coach/training/LibraryPages.tsx:27:592b21d3`
- `useCoachFullApp.ts` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:16:ffe3ac05` · `portal/src/portal/coach/card/harness.testdata.tsx:102:e33dd03d` · `portal/src/portal/coach/pages/CoachSchool.tsx:12:ffe3ac05` · `portal/src/portal/coach/pages/CoachTeacher.tsx:10:ffe3ac05` (+3: `python3 kg/kg.py who-reads useCoachFullApp.ts`)

## Tests (all, generated)
- `CoachAppGuard.tsx` ← `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/coach/people/schoolsReady.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.loop.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.rm.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/coach/training/CoachAppGuard.tsx`)
- `LibraryPages.tsx` ← `portal/src/portal/coach/training/library.test.tsx` · `portal/src/portal/coach/training/redesign.test.tsx` · `portal/src/portal/fln/libraryHook.test.tsx`
- `appReady.ts` ← `portal/src/portal/coach/card/switchOn.test.tsx` · `portal/src/portal/coach/coachTraining/CoachTrainingPage.test.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/coach/people/schoolsReady.test.tsx` · `portal/src/portal/coach/report/CoachReportPage.test.tsx` · `portal/src/portal/coach/report/CoachWeekPage.test.tsx` (+7: `python3 kg/kg.py who-reads portal/src/portal/coach/training/appReady.ts`)
- `copy.ts` ← `portal/src/portal/coach/training/library.test.tsx`
- `useCoachFullApp.ts` ← `portal/src/portal/coach/training/appReady.fullApp.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/rm/CLAUDE.md`?
