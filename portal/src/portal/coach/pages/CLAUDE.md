# pages — Coach v2 page components: schedule, observe flow, people, reports
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/pages kg=e7b2181c058c gen=de5fec1da7fa overflow=98 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `CoachObservation.tsx` — the one observation page every report row opens
- `CoachCheckSend.tsx` — recording, plan and photos, then send
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/pages`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachAndroidFiles.test.tsx` | (unmapped) |
| `CoachObserveFlow.test.tsx` | Pins the Visit page order, square Start/Upload buttons, Record, Pause and Stop flow |
| `CoachBack.test.tsx` | Pins coach Back arrows: page parent, fixed parent when opened cold, Sending goes to the Visit |
| `CoachCheckSend*` | 4 files; most used `CoachCheckSend.tsx`: Check and send: play recording, attach plan (recent, library or own file), photos, then send observation |
| … | 47 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `CoachPeople.tsx` ← imported by `portal/src/App.tsx:130:90c8f423` · `portal/src/portal/coach/card/harness.testdata.tsx:46:4b3728bb` (+1)
- `CoachRecord.tsx` ← imported by `portal/src/App.tsx:139:7da3ce99` · `portal/src/portal/teacher/principal/routes.tsx:13:d60efdfb` (+1)
- `CoachAttach.tsx` ← imported by `portal/src/App.tsx:140:275f6ea3` · `portal/src/portal/teacher/principal/routes.tsx:14:79596b0c`
- … 20 more → `CLAUDE.index.md`

## Never (human)
- Coach 'today' is the Pakistan day, not the device's (pages/CoachTodayKarachi.test.tsx:20, bd-o15qnr.23)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` (CoachHome.tsx, CoachNewVisit.tsx, CoachObserve.tsx, CoachObservePick.tsx, CoachPeople.tsx, CoachReports.tsx, CoachScheduling.tsx)
- `portal/src/portal/coach/people/checks.test.tsx` (CoachAddSchool.tsx, CoachAddTeacher.tsx, CoachEditTeacher.tsx, CoachPeople.tsx, CoachRemoveTeachers.tsx, CoachSchool.tsx, CoachTeacher.tsx)
- … 39 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/observe/CLAUDE.md`? · `portal/src/portal/coach/people/CLAUDE.md`? · `portal/src/portal/coach/reports/CLAUDE.md`?
