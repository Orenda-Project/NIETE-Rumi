# pages — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/pages -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CoachAddSchool.tsx` | Add a school page: search every school by name or EMIS, add with one tap (WhatsApp /observe parity) |
| `CoachAddTeacher.tsx` | Add a teacher to a school by WhatsApp number, one question per screen, then confirm |
| `CoachAttach.tsx` | Upload recording for one scheduled visit: pick and validate a sound file, then go to Check and send (bd-4404s7.4) |
| `CoachBack.test.tsx` | Pins coach Back arrows: page parent, fixed parent when opened cold, Sending goes to the Visit |
| `CoachCheckSend.tsx` | Check and send: play recording, attach plan (recent, library or own file), photos, then send observation |
| `CoachEditTeacher.test.tsx` | Pins Edit teacher: name, role, teaching level, phone check, school move, remove (bd-o15qnr.11, .13) |
| `CoachEditTeacher.tsx` | Edit teacher screen saving through the ported /observe edit path (name, role, level, phone, school) |
| `CoachFeedback1.test.tsx` | Pins operator round 1: teacher phone in pickers, past-day booking, no AM/PM warning (bd-o15qnr.8) |
| `CoachHome.tsx` | Coach Home on the kit: NIETE band, reports banner, today's visits, feature tiles from GET /coach/home |
| `CoachLpEngagement.test.tsx` | Pins Exams generated and Lesson plans opened on teacher and visit pages, dash if off Rumi (bd-o15qnr.20) |
| `CoachManageSchools.test.tsx` | Pins Add school, School Manage, Remove school and Add teacher flows |
| `CoachNewVisit.test.tsx` | Pins New visit in three steps (school, teacher, day and time), time toggles, Reschedule (bd-o15qnr) |
| `CoachNewVisit.tsx` | New visit: pick school, pick teacher, pick day and time, then Visit scheduled; also Reschedule |
| `CoachObsTrack.test.tsx` | Pins the one observation page opened from every Reports row and HITL row (bd-o15qnr.19) |
| `CoachObservation.lessonPlan.test.tsx` | Pins the observation page's Lesson plan row states, English and Urdu (bd-fmf24g.66) |
| `CoachObservation.tsx` | The one v2 observation page with five steps, opened from Reports and teacher History (bd-o15qnr.19) |
| `CoachObservation.whatsapp.test.tsx` | Pins viewing a WhatsApp-made observation in full on the portal (bd-15y1pc) |
| `CoachObserve.test.tsx` | Pins Observe hub, Pick the teacher and Visit page with Start or Upload recording (bd-4404s7.4) |
| `CoachObserve.tsx` | Observe hub: Take observation and Reports tiles plus Next visit (bd-4404s7.4) |
| `CoachObserveFlow.test.tsx` | Pins the Visit page order, square Start/Upload buttons, Record, Pause and Stop flow |
| `CoachObservePick.tsx` | Take observation step 1: pick the teacher from scheduled visits grouped by day with Earlier fold |
| `CoachOwnPlan.test.tsx` | Pins Their own plan picker on Check and send: file rules, Camera/Gallery/Files, Remove plan |
| `CoachPeople.test.tsx` | Pins Schools and Teachers tabs, school and teacher pages, sort chips, Urdu (bd-o15qnr) |
| `CoachPeople.tsx` | Schools & teachers page with Schools and Teachers tabs, sort chips and status chips |
| `CoachRecord.tsx` | Record observation screen: timer ring, level meter, Pause and Stop for one visit |
| `CoachRemoveTeachers.tsx` | Remove teachers from a school: tick up to 30, then confirm what removal means |
| `CoachReports.test.tsx` | Pins Reports: Waiting for you, In progress, Recent by day, See all, ?show=waiting |
| `CoachReports.tsx` | Reports page: waiting and in-progress cards with four segments, collapsible Recent list |
| `CoachRound3.test.tsx` | Pins operator round 3: full-date subheading, History by month, Avg. HITL Score label (bd-o15qnr.18) |
| `CoachSchedule.tsx` | My schedule: week strip with a dot per visit, overdue first, tap a day to filter |
| `CoachScheduling.test.tsx` | Pins Schedule hub, My schedule and Team schedule screens |
| `CoachScheduling.tsx` | Schedule hub with three tiles: New visit, My schedule, Team schedule |
| `CoachSchool.tsx` | One school page: four KPI tiles, its teachers never-visited first, and Manage group |
| `CoachSending.tsx` | Sending screen: progress ring while files upload, leave-and-we'll-tell-you line |
| `CoachTeacher.history.test.tsx` | Pins that teacher History rows open HITL reports, DC rows are information only (bd-o15qnr.10) |
| `CoachTeacher.tsx` | One teacher: average HITL score, score chart, KPI tiles, History by month, Schedule visit |
| `CoachTeam.tsx` | Team schedule: totals, one coach or all, week counts and visits grouped by time |
| `CoachTodayKarachi.test.tsx` | Pins that coach 'today' is the Pakistan day whatever the device timezone (bd-o15qnr.23) |
| `CoachVisit.tsx` | One scheduled visit: teacher card, Start/Upload recording squares, Reschedule and Cancel |

## Who reads this (all, generated)
- `CoachAddSchool.tsx` ← imported by `portal/src/App.tsx:122:cceabff9`
- `CoachAddTeacher.tsx` ← imported by `portal/src/App.tsx:123:05ba7594`
- `CoachAttach.tsx` ← imported by `portal/src/App.tsx:127:275f6ea3`
- `CoachCheckSend.tsx` ← imported by `portal/src/App.tsx:128:e909be90`
- `CoachEditTeacher.tsx` ← imported by `portal/src/App.tsx:137:f2cadfd8`
- `CoachHome.tsx` ← imported by `portal/src/portal/coach/card/CoachLanding.tsx:3:f585e580`
- `CoachNewVisit.tsx` ← imported by `portal/src/App.tsx:111:ba1e5868`
- `CoachObservation.tsx` ← imported by `portal/src/App.tsx:130:29242f44`
- `CoachObserve.tsx` ← imported by `portal/src/App.tsx:112:034cb9cf`
- `CoachObservePick.tsx` ← imported by `portal/src/App.tsx:113:545aba11`
- `CoachPeople.tsx` ← imported by `portal/src/App.tsx:118:90c8f423` · `portal/src/portal/coach/card/harness.testdata.tsx:43:4b3728bb` · `portal/src/portal/coach/pages/CoachSchool.tsx:11:ec5002d2`
- `CoachRecord.tsx` ← imported by `portal/src/App.tsx:126:7da3ce99` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:23:9e4007c8`
- `CoachRemoveTeachers.tsx` ← imported by `portal/src/App.tsx:124:d86660b8`
- `CoachReports.tsx` ← imported by `portal/src/App.tsx:115:1fa94ad3`
- `CoachSchedule.tsx` ← imported by `portal/src/App.tsx:109:e2039db2`
- `CoachScheduling.tsx` ← imported by `portal/src/App.tsx:108:90cdf75d`
- `CoachSchool.tsx` ← imported by `portal/src/App.tsx:121:a4567313` · `portal/src/portal/coach/card/harness.testdata.tsx:43:4b3728bb`
- `CoachSending.tsx` ← imported by `portal/src/App.tsx:129:254fef38`
- `CoachTeacher.tsx` ← imported by `portal/src/App.tsx:125:6c98160d` · `portal/src/portal/coach/card/harness.testdata.tsx:44:7acd1021`
- `CoachTeam.tsx` ← imported by `portal/src/App.tsx:110:6ebe5b32`
- `CoachVisit.tsx` ← imported by `portal/src/App.tsx:114:399d7ba2`

## Tests (all, generated)
- `CoachAddSchool.tsx` ← `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` · `portal/src/portal/coach/people/checks.test.tsx`
- `CoachAddTeacher.tsx` ← `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` · `portal/src/portal/coach/people/checks.test.tsx`
- `CoachAttach.tsx` ← `portal/src/portal/coach/PendingBanner.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx`
- `CoachCheckSend.tsx` ← `portal/src/portal/coach/PendingBanner.test.tsx` · `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/coach/pages/CoachOwnPlan.test.tsx`
- `CoachEditTeacher.tsx` ← `portal/src/portal/coach/pages/CoachEditTeacher.test.tsx` · `portal/src/portal/coach/people/checks.test.tsx`
- `CoachHome.tsx` ← `portal/src/portal/coach/home/CoachHome.test.tsx` · `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachRound3.test.tsx`
- `CoachNewVisit.tsx` ← `portal/src/portal/coach/canvasColours.test.tsx` · `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachNewVisit.test.tsx` · `portal/src/portal/coach/pages/CoachTodayKarachi.test.tsx` · `portal/src/portal/coach/schedule/schedule.ur.test.tsx`
- `CoachObservation.tsx` ← `portal/src/portal/coach/pages/CoachObsTrack.test.tsx` · `portal/src/portal/coach/pages/CoachObservation.lessonPlan.test.tsx` · `portal/src/portal/coach/pages/CoachObservation.whatsapp.test.tsx` · `portal/src/portal/coach/pages/CoachTeacher.history.test.tsx`
- `CoachObserve.tsx` ← `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachObserve.test.tsx`
- `CoachObservePick.tsx` ← `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachObserve.test.tsx` · `portal/src/portal/coach/pages/CoachTodayKarachi.test.tsx`
- `CoachPeople.tsx` ← `portal/src/portal/coach/canvasColours.test.tsx` · `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` · `portal/src/portal/coach/pages/CoachPeople.test.tsx` · `portal/src/portal/coach/pages/CoachRound3.test.tsx` · `portal/src/portal/coach/people/checks.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/coach/pages/CoachPeople.tsx`)
- `CoachRecord.tsx` ← `portal/src/portal/coach/PendingBanner.test.tsx` · `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx`
- `CoachRemoveTeachers.tsx` ← `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` · `portal/src/portal/coach/people/checks.test.tsx`
- `CoachReports.tsx` ← `portal/src/portal/coach/PendingBanner.test.tsx` · `portal/src/portal/coach/canvasColours.test.tsx` · `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachObsTrack.test.tsx` · `portal/src/portal/coach/pages/CoachReports.test.tsx`
- `CoachSchedule.tsx` ← `portal/src/portal/coach/pages/CoachScheduling.test.tsx` · `portal/src/portal/coach/pages/CoachTodayKarachi.test.tsx` · `portal/src/portal/coach/schedule/schedule.ur.test.tsx`
- `CoachScheduling.tsx` ← `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachScheduling.test.tsx` · `portal/src/portal/coach/schedule/schedule.ur.test.tsx`
- `CoachSchool.tsx` ← `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` · `portal/src/portal/coach/pages/CoachPeople.test.tsx` · `portal/src/portal/coach/people/checks.test.tsx` · `portal/src/portal/coach/people/schoolsReady.test.tsx`
- `CoachSending.tsx` ← `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/coach/pages/CoachOwnPlan.test.tsx`
- `CoachTeacher.tsx` ← `portal/src/portal/coach/pages/CoachEditTeacher.test.tsx` · `portal/src/portal/coach/pages/CoachLpEngagement.test.tsx` · `portal/src/portal/coach/pages/CoachObsTrack.test.tsx` · `portal/src/portal/coach/pages/CoachPeople.test.tsx` · `portal/src/portal/coach/pages/CoachRound3.test.tsx` · `portal/src/portal/coach/pages/CoachTeacher.history.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/portal/coach/pages/CoachTeacher.tsx`)
- `CoachTeam.tsx` ← `portal/src/portal/coach/pages/CoachScheduling.test.tsx` · `portal/src/portal/coach/schedule/schedule.ur.test.tsx`
- `CoachVisit.tsx` ← `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachLpEngagement.test.tsx` · `portal/src/portal/coach/pages/CoachObsTrack.test.tsx` · `portal/src/portal/coach/pages/CoachObserve.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/coach/pages/CoachTodayKarachi.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/people/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
