# pages — Coach v2 page components: schedule, observe flow, people, reports
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/pages kg=c1264987b527 gen=b30f811d4a6e overflow=109 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `CoachObservation.tsx` — the one observation page every report row opens
- `CoachCheckSend.tsx` — recording, plan and photos, then send
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/pages`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachAndroidFiles.test.tsx` | (unmapped) |
| `CoachCheckSend*` | 7 files; most used `CoachCheckSend.tsx`: Check and send: play recording, attach plan (recent, library or own file), photos, then send observation |
| `CoachObservation*` | 6 files; most used `CoachObservation.tsx`: The one v2 observation page with five steps, opened from Reports and teacher History (bd-o15qnr.19) |
| `CoachObserveFlow.test.tsx` | Pins the Visit page order, square Start/Upload buttons, Record, Pause and Stop flow |
| … | 50 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `CoachAttach.tsx` ← imported by `portal/src/App.tsx:140:275f6ea3` · `portal/scripts/attach-shot/harness.tsx:11:1ea4aaa3` (+1)
- `CoachNewVisit.tsx` ← imported by `portal/src/App.tsx:123:ba1e5868` · `portal/src/portal/teacher/principal/NewVisit.tsx:5:4e5d8a97` (+1)
- `CoachPeople.tsx` ← imported by `portal/src/App.tsx:130:90c8f423` · `portal/src/portal/coach/card/harness.testdata.tsx:46:4b3728bb` (+1)
- … 20 more → `CLAUDE.index.md`

## Never (human)
- Coach 'today' is the Pakistan day, not the device's (pages/CoachTodayKarachi.test.tsx:20, bd-o15qnr.23)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` (CoachHome.tsx, CoachNewVisit.tsx, CoachObserve.tsx, CoachObservePick.tsx, CoachPeople.tsx, CoachReports.tsx, CoachScheduling.tsx)
- `portal/src/portal/coach/people/checks.test.tsx` (CoachAddSchool.tsx, CoachAddTeacher.tsx, CoachEditTeacher.tsx, CoachPeople.tsx, CoachRemoveTeachers.tsx, CoachSchool.tsx, CoachTeacher.tsx)
- … 50 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/observe/CLAUDE.md`? · `portal/src/portal/coach/people/CLAUDE.md`? · `portal/src/portal/newui/lessons/CLAUDE.md`?
