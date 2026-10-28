# pages — Coach v2 page components: schedule, observe flow, people, reports
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/pages kg=df998b3b750d gen=43e5c80f1820 overflow=76 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `CoachObservation.tsx` — the one observation page every report row opens
- `CoachCheckSend.tsx` — recording, plan and photos, then send
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/pages`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachObserveFlow.test.tsx` | Pins the Visit page order, square Start/Upload buttons, Record, Pause and Stop flow |
| `CoachBack.test.tsx` | Pins coach Back arrows: page parent, fixed parent when opened cold, Sending goes to the Visit |
| `CoachOwnPlan.test.tsx` | Pins Their own plan picker on Check and send: file rules, Camera/Gallery/Files, Remove plan |
| … | 36 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `CoachPeople.tsx` ← imported by `portal/src/App.tsx:118:90c8f423` · `portal/src/portal/coach/card/harness.testdata.tsx:43:4b3728bb` (+1)
- `CoachRecord.tsx` ← imported by `portal/src/App.tsx:126:7da3ce99` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:23:9e4007c8`
- `CoachSchool.tsx` ← imported by `portal/src/App.tsx:121:a4567313` · `portal/src/portal/coach/card/harness.testdata.tsx:43:4b3728bb`
- … 18 more → `CLAUDE.index.md`

## Never (human)
- Coach 'today' is the Pakistan day, not the device's (pages/CoachTodayKarachi.test.tsx:20, bd-o15qnr.23)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` (CoachHome.tsx, CoachNewVisit.tsx, CoachObserve.tsx, CoachObservePick.tsx, CoachPeople.tsx, CoachReports.tsx, CoachScheduling.tsx)
- `portal/src/portal/coach/people/checks.test.tsx` (CoachAddSchool.tsx, CoachAddTeacher.tsx, CoachEditTeacher.tsx, CoachPeople.tsx, CoachRemoveTeachers.tsx, CoachSchool.tsx, CoachTeacher.tsx)
- … 22 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/home/CLAUDE.md`? · `portal/src/portal/coach/observe/CLAUDE.index.md`? · `portal/src/portal/coach/observe/CLAUDE.md`? · `portal/src/portal/coach/pages/CLAUDE.index.md`? (+9)
