# pages — Coach v2 page components: schedule, observe flow, people, reports
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/pages kg=a5baae91fbc4 gen=7b3009f42a9f overflow=116 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `CoachObservation.tsx` — the one observation page every report row opens
- `CoachCheckSend.tsx` — recording, plan and photos, then send
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/pages`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachVisit.tsx` | One scheduled visit: teacher card, Start/Upload recording squares, Reschedule and Cancel |
| `CoachAndroidFiles.test.tsx` | (unmapped) |
| `CoachCheckSend*` | 8 files; most used `CoachCheckSend.tsx`: Check and send: play recording, attach plan (recent, library or own file), photos, then send observation |
| `CoachObservation*` | 6 files; most used `CoachObservation.tsx`: The one v2 observation page with five steps, opened from Reports and teacher History (bd-o15qnr.19) |
| … | 51 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `CoachAttach.tsx` ← imported by `portal/src/App.tsx:140:275f6ea3` · `portal/src/portal/teacher/principal/routes.tsx:15:79596b0c` (+1)
- `CoachNewVisit.tsx` ← imported by `portal/src/App.tsx:123:ba1e5868` · `portal/src/portal/teacher/principal/NewVisit.tsx:5:4e5d8a97` (+1)
- `CoachPeople.tsx` ← imported by `portal/src/App.tsx:130:90c8f423` · `portal/src/portal/coach/card/harness.testdata.tsx:46:4b3728bb` (+1)
- … 20 more → `CLAUDE.index.md`

## Never (human)
- Coach 'today' is the Pakistan day, not the device's (pages/CoachTodayKarachi.test.tsx:20, bd-o15qnr.23)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` (CoachHome.tsx, CoachNewVisit.tsx, CoachObserve.tsx, CoachObservePick.tsx, CoachPeople.tsx, CoachReports.tsx, CoachScheduling.tsx)
- `portal/src/portal/coach/people/checks.test.tsx` (CoachAddSchool.tsx, CoachAddTeacher.tsx, CoachEditTeacher.tsx, CoachPeople.tsx, CoachRemoveTeachers.tsx, CoachSchool.tsx, CoachTeacher.tsx)
- … 57 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/observe/CLAUDE.md`? · `portal/src/portal/coach/people/CLAUDE.md`? · `portal/src/portal/newui/lessons/CLAUDE.md`?
