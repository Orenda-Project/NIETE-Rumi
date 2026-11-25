# observe — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/observe -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `ContinueOnWhatsApp.test.tsx` | (unmapped) |
| `ContinueOnWhatsApp.tsx` | (unmapped) |
| `ObservationNotes.tsx` | (unmapped) |
| `ObservePage.tsx` | Frame of every Observe screen: coach gate, kit TeacherPage and the reports-waiting banner |
| `ObservePage.whatsapp.test.tsx` | (unmapped) |
| `PhoneRecord.tsx` | (unmapped) |
| `PlanState.tsx` | Row and chip showing what became of the coach's attached lesson plan: Reading, Read, Couldn't read (bd-fmf24g.66) |
| `checks.test.tsx` | Source-scan test that Observe screens keep kit design rules and hold no words in components (bd-4404s7.4) |
| `copy.test.ts` | Pins Observe copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.4) |
| `copy.ts` | All English and Urdu words of the coach Observe screens (hub, pick, visit, record, upload, send) |
| `format.emptyRecording.test.ts` | (unmapped) |
| `format.ts` | Small formatters for visit day, recording length, plan kind and failure wording in Observe |
| `inAppBack.test.tsx` | (unmapped) |
| `keptRecording.ts` | (unmapped) |
| `madeWhen.test.ts` | (unmapped) |
| `observeRoutes.tsx` | (unmapped) |
| `sender.test.ts` | Pins background observation sender: returns at once, retries same observation, frees phone copy (bd-4404s7.4) |
| `sender.ts` | Background sender running coachObserve.sendObservation with notices so leaving the page does not stop it |
| `startRetry.test.ts` | (unmapped) |
| `trouble.ts` | (unmapped) |
| `uploadOnly.ts` | (unmapped) |

## Who reads this (all, generated)
- `ContinueOnWhatsApp.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:32:b32d2e34` · `portal/src/portal/coach/observe/ObservePage.tsx:13:8e5b57fa`
- `ObservationNotes.tsx` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:20:fbb9b2da` · `portal/src/portal/coach/pages/CoachRecord.tsx:15:fbb9b2da` · `portal/src/portal/coach/reports/V6Parts.tsx:11:f71e9f45`
- `ObservePage.tsx` ← imported by `portal/src/portal/coach/flow/routes.tsx:8:56e7ec98` · `portal/src/portal/coach/pages/CoachAttach.tsx:11:56e7ec98` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:32:56e7ec98` · `portal/src/portal/coach/pages/CoachNewVisit.tsx:17:56e7ec98` (+8: `python3 kg/kg.py who-reads ObservePage.tsx`)
- `PhoneRecord.tsx` ← imported by `portal/src/portal/coach/pages/CoachRecord.tsx:28:4fc82397`
- `PlanState.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:25:43b31e37` · `portal/src/portal/coach/reports/FeedbackForm.tsx:19:6052db15`
- `copy.ts` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:7:62284d5a` · `portal/src/portal/coach/flow/VisitV7.tsx:14:62284d5a` · `portal/src/portal/coach/pages/CoachAttach.tsx:9:62284d5a` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:28:555a148a` (+21: `python3 kg/kg.py who-reads copy.ts`)
- `format.ts` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:10:98dc3f3f` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:29:6bc0dd9f` · `portal/src/portal/coach/pages/CoachObserve.tsx:9:803bd941` · `portal/src/portal/coach/pages/CoachObservePick.tsx:10:803bd941` (+7: `python3 kg/kg.py who-reads format.ts`)
- `keptRecording.ts` ← imported by `portal/src/portal/coach/pages/CoachRecord.tsx:29:e5d1bddc` · `portal/src/portal/coach/pages/CoachVisit.tsx:25:e5d1bddc` · `portal/src/portal/coach/observe/PhoneRecord.tsx:11:3a666daf`
- `observeRoutes.tsx` ← imported by `portal/src/portal/coach/flow/FeedbackPage.tsx:5:3d973a7c` · `portal/src/portal/coach/pages/CoachAttach.tsx:12:3d973a7c` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:33:3d973a7c` · `portal/src/portal/coach/pages/CoachObservation.tsx:2:3d973a7c` (+12: `python3 kg/kg.py who-reads observeRoutes.tsx`)
- `sender.ts` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:34:ffdb7ce5` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:22:381973db` · `portal/src/portal/coach/pages/CoachSending.tsx:11:7fb137e1` · `portal/src/portal/coach/pages/CoachVisit.tsx:17:7fb137e1` (+2: `python3 kg/kg.py who-reads sender.ts`)
- `trouble.ts` ← imported by `portal/src/portal/coach/ui.tsx:2:bf2adaf3` · `portal/src/portal/coach/observe/ContinueOnWhatsApp.tsx:7:7f2ae5a9` · `portal/src/portal/coach/observe/ObservePage.tsx:14:06fbd5ae`
- `uploadOnly.ts` ← imported by `portal/src/portal/coach/pages/CoachRecord.tsx:27:4754cdb3` · `portal/src/portal/coach/pages/CoachVisit.tsx:24:4754cdb3` · `portal/src/portal/coach/reports/Debrief.tsx:35:4754cdb3`

## Tests (all, generated)
- `ContinueOnWhatsApp.tsx` ← `portal/src/portal/coach/observe/ContinueOnWhatsApp.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/flow/flowV2.test.tsx` · `portal/src/portal/coach/flow/v6.test.tsx` · `portal/src/portal/coach/observe/copy.test.ts` · `portal/src/portal/coach/observe/format.emptyRecording.test.ts` · `portal/src/portal/coach/observe/madeWhen.test.ts` · `portal/src/portal/coach/observe/startRetry.test.ts` (+4: `python3 kg/kg.py who-reads portal/src/portal/coach/observe/copy.ts`)
- `format.ts` ← `portal/src/portal/coach/observe/copy.test.ts` · `portal/src/portal/coach/observe/format.emptyRecording.test.ts` · `portal/src/portal/coach/observe/madeWhen.test.ts` · `portal/src/portal/coach/observe/startRetry.test.ts` · `portal/src/portal/coach/pages/CoachAndroidFiles.test.tsx`
- `observeRoutes.tsx` ← `portal/src/portal/coach/flow/stopped245.test.tsx` · `portal/src/portal/coach/flow/v7.test.tsx` · `portal/src/portal/coach/flow/v7visit39.test.tsx` · `portal/src/portal/coach/flow/visit47.test.tsx` · `portal/src/portal/coach/flow/visitTake49.test.tsx` · `portal/src/portal/coach/observe/ObservePage.whatsapp.test.tsx` (+15: `python3 kg/kg.py who-reads portal/src/portal/coach/observe/observeRoutes.tsx`)
- `sender.ts` ← `portal/src/portal/coach/flow/inProgress45.test.tsx` · `portal/src/portal/coach/observe/sender.test.ts` · `portal/src/portal/coach/observe/startRetry.test.ts` · `portal/src/portal/coach/pages/CoachAndroidFiles.test.tsx` · `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachCheckSend.attachPlan.test.tsx` (+12: `python3 kg/kg.py who-reads portal/src/portal/coach/observe/sender.ts`)
- `trouble.ts` ← `portal/src/portal/coach/observe/ContinueOnWhatsApp.test.tsx`
- `uploadOnly.ts` ← `portal/src/portal/coach/observe/inAppBack.test.tsx`

## Related (all, generated)
- docs: `portal/src/lib/CLAUDE.md`? · `portal/src/portal/coach/CLAUDE.md`?
