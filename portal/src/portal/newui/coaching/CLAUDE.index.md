# coaching — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/newui/coaching -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `CoachingMain.test.tsx` | bd-5rz1v.26: new Coaching main page (band, lesson list, which Coaching she gets by flags) |
| `CoachingMain.tsx` | New-UI teacher Coaching main page: lesson list, analysing counts, Record entry; replaces CoachingHome |
| `LessonView.test.tsx` | bd-5rz1v.26: new lesson page on its way (Hero) and the report, plus which lesson page she gets |
| `LessonView.tsx` | New-UI one-lesson page at /portal/coaching/session/:id: analysing Hero, then report, audio, feedback |
| `LevelBars.tsx` | bd-5rz1v.26: new-UI moving level bars while recording (red live, grey flat paused) |
| `LibraryStep.tsx` | bd-5rz1v.26: new-UI "From the library" stepwise lesson-plan picker (grade, subject, chapter, lesson) |
| `LiveMovesList.test.tsx` | bd-v0toag.31: live-moves list (done/now/to come), MoveTapSheet and LiveMovesPanel behaviour |
| `LiveMovesList.tsx` | bd-v0toag.31: step list a group D teacher sees while recording: done, now (with what to say), to come |
| `LogoutWhileRecording.test.tsx` | bd-5rz1v.26.4: Logout while recording asks "Stop recording?" in a kit Sheet; keep or stop behaviour |
| `LogoutWhileRecording.tsx` | bd-5rz1v.26.4: "Stop recording?" sheet shown on Logout while a lesson records, new-UI look |
| `MoveTapSheet.tsx` | bd-v0toag.31: sheet for her answer on one live move (I did this / No, I didn't) |
| `PickStage.tsx` | bd-v0toag.31: before Record, group D teacher picks the lesson being taught from recent plans or skips |
| `PlanSheet.tsx` | bd-5rz1v.26: Check and send's lesson-plan sheet (recent, library, or file) for the recorded lesson |
| `RecordPage.live.test.tsx` | bd-v0toag.31: group D picks a plan before Record when GET /live-moves/eligible says yes within 1.5 s |
| `RecordPage.test.tsx` | bd-5rz1v.26: /portal/coaching/new new-UI record then check-and-send flow, route state from Coaching |
| `RecordPage.tsx` | New-UI /portal/coaching/new: record or upload a lesson, then check and send (replaces PortalCoachingRecord) |
| `RecordingBar.newUi.test.tsx` | bd-5rz1v.26/.24: recording bar restyled for the new menu, and never overlapping a page's bottom button |
| `SendSheet.tsx` | bd-5rz1v.26: new-UI "Send a lesson" sheet with Record and Upload rows and Cancel |
| `coachingApi.ts` | bd-5rz1v.26: getRecentPlans (GET /api/portal/lesson-plans/recent) and pickOf for Check and send's recent plans |
| `lessonRows.ts` | bd-5rz1v.26: builds Coaching list rows (finished and in-flight lessons, newest first, month labels, chips) |
| `liveCopy.test.ts` | bd-v0toag.31: every LIVE_COPY string has its Urdu translation |
| `liveCopy.ts` | bd-v0toag.31: English and Urdu words a group D teacher reads in live moves while recording |
| `liveEligible.test.ts` | bd-v0toag.31 I-1: Record does not wait on the live-eligibility hop for non-D teachers, waits at most 1.5 s |
| `liveEligible.ts` | bd-v0toag.31: prefetched is-live-moves-on answer; Record uses the last answer or waits at most 1.5 s |
| `pickerWords.ts` | bd-fmf24g.13: widened word set for the lesson-plan picker so teacher v2 can pass translations |
| `useLiveMoves.test.ts` | bd-v0toag.31: useLiveMoves card fetch, recorder-chunk tee, 60 s detect calls, failures never touch the recording |
| `useLiveMoves.ts` | bd-v0toag.31: hook driving live moves while recording: card, Soniox tee, detect every 60 s, record on send |
| `useSendFlow.ts` | Hook running the record, check and send stages for a lesson (recorder, plan pick, upload) for RecordPage |

## Who reads this (all, generated)
- `CoachingMain.tsx` ← imported by `portal/src/portal/pages/PortalCoaching.tsx:16:a7844c9e`
- `LessonView.tsx` ← imported by `portal/src/portal/pages/PortalCoachingDetail.tsx:17:46cbb2c3`
- `LevelBars.tsx` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:15:5264df61` · `portal/src/portal/teacher/coaching/SendPage.tsx:10:5264df61` · `portal/src/portal/newui/coaching/RecordPage.tsx:22:26baa4bf`
- `LibraryStep.tsx` ← imported by `portal/src/portal/newui/coaching/PlanSheet.tsx:10:f7ec9085` · `portal/src/portal/newui/coaching/RecordPage.tsx:23:a7962333`
- `LiveMovesList.tsx` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:28:f3f0a8dd` · `portal/src/portal/teacher/coaching/NewObservation.tsx:16:b6cdfcae` · `portal/src/portal/teacher/coaching/SendPage.tsx:13:b6cdfcae` · `portal/src/portal/newui/coaching/RecordPage.tsx:27:130c6055`
- `LogoutWhileRecording.tsx` ← imported by `portal/src/portal/lib/recordingSession.tsx:3:ad060b75`
- `MoveTapSheet.tsx` ← imported by `portal/src/portal/newui/coaching/LiveMovesList.tsx:7:007feb81`
- `PickStage.tsx` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:29:f7e7c349` · `portal/src/portal/newui/coaching/RecordPage.tsx:26:96dac6de`
- `PlanSheet.tsx` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:17:83b1e0f3` · `portal/src/portal/newui/coaching/RecordPage.tsx:24:7e784f3a`
- `RecordPage.tsx` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:26:3888a37e`
- `SendSheet.tsx` ← imported by `portal/src/portal/newui/coaching/CoachingMain.tsx:23:6574d9ad`
- `coachingApi.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:14:db7c37b9` · `portal/src/portal/newui/coaching/PickStage.tsx:9:8763fd6d` · `portal/src/portal/newui/coaching/PlanSheet.tsx:9:8763fd6d`
- `lessonRows.ts` ← imported by `portal/src/portal/newui/coaching/CoachingMain.tsx:24:dddb345c` · `portal/src/portal/newui/coaching/LessonView.tsx:26:4be89a8a`
- `liveCopy.ts` ← imported by `portal/src/portal/newui/coaching/LiveMovesList.tsx:8:4bdfa8a6` · `portal/src/portal/newui/coaching/MoveTapSheet.tsx:4:4bdfa8a6` · `portal/src/portal/newui/coaching/PickStage.tsx:11:4bdfa8a6`
- `liveEligible.ts` ← imported by `portal/src/portal/components/coaching/CoachingHome.tsx:18:52cc7c5c` · `portal/src/portal/pages/PortalCoachingRecord.tsx:30:837ca0f3` · `portal/src/portal/newui/coaching/CoachingMain.tsx:13:8c9b671e` · `portal/src/portal/newui/coaching/useSendFlow.ts:11:e9cd450b`
- `pickerWords.ts` ← imported by `portal/src/portal/teacher/coaching/copy.ts:19:6c7e6daa` · `portal/src/portal/newui/coaching/LibraryStep.tsx:11:1d044371` · `portal/src/portal/newui/coaching/PickStage.tsx:10:79f377e8` · `portal/src/portal/newui/coaching/PlanSheet.tsx:11:1d044371` (+1: `python3 kg/kg.py who-reads pickerWords.ts`)
- `useLiveMoves.ts` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:27:21db6050` · `portal/src/portal/teacher/coaching/NewObservation.tsx:18:0c3ada55` · `portal/src/portal/teacher/coaching/SendPage.tsx:12:0c3ada55` · `portal/src/portal/newui/coaching/LiveMovesList.tsx:6:784e449b` (+1: `python3 kg/kg.py who-reads useLiveMoves.ts`)
- `useSendFlow.ts` ← imported by `portal/src/portal/pages/legacyLive.ts:2:0faa2c0f` · `portal/src/portal/teacher/coaching/NewObservation.tsx:19:27d04c12` · `portal/src/portal/teacher/coaching/SendPage.tsx:11:02cdb913` · `portal/src/portal/teacher/coaching/draft.ts:3:27d04c12` (+2: `python3 kg/kg.py who-reads useSendFlow.ts`)

## Tests (all, generated)
- `CoachingMain.tsx` ← `portal/src/portal/newui/coaching/CoachingMain.test.tsx`?
- `LessonView.tsx` ← `portal/src/portal/newui/coaching/LessonView.test.tsx`?
- `LibraryStep.tsx` ← `portal/src/portal/teacher/coaching/picker.ur.test.tsx`
- `LiveMovesList.tsx` ← `portal/src/portal/newui/coaching/LiveMovesList.test.tsx`
- `LogoutWhileRecording.tsx` ← `portal/src/portal/newui/coaching/LogoutWhileRecording.test.tsx`?
- `MoveTapSheet.tsx` ← `portal/src/portal/newui/coaching/LiveMovesList.test.tsx`
- `PlanSheet.tsx` ← `portal/src/portal/teacher/coaching/picker.ur.test.tsx`
- `RecordPage.tsx` ← `portal/src/portal/newui/coaching/RecordPage.test.tsx`?
- `SendSheet.tsx` ← `portal/src/portal/fln/share/SendSheet.test.tsx`?
- `coachingApi.ts` ← `portal/src/portal/fln/tests/readers.test.tsx` · `portal/src/portal/teacher/coaching/picker.ur.test.tsx`
- `liveCopy.ts` ← `portal/src/portal/newui/coaching/liveCopy.test.ts`
- `liveEligible.ts` ← `portal/src/portal/components/coaching/CoachingHome.live.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` · `portal/src/portal/newui/coaching/liveEligible.test.ts` · `portal/src/portal/pages/PortalCoachingRecord.live.test.tsx`
- `useLiveMoves.ts` ← `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` · `portal/src/portal/newui/coaching/useLiveMoves.test.ts` · `portal/src/portal/pages/PortalCoachingRecord.live.test.tsx` · `portal/src/portal/teacher/coaching/NewObservation.live.test.tsx` · `portal/src/portal/teacher/coaching/SendPage.live.test.tsx`
- `useSendFlow.ts` ← `portal/src/portal/newui/coaching/useLiveMoves.test.ts` · `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/coaching/picker.ur.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/components/coaching/CLAUDE.index.md`? · `portal/src/portal/fln/share/CLAUDE.index.md`? · `portal/src/portal/fln/share/CLAUDE.md`? · `portal/src/portal/fln/tests/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.md`? · `portal/src/portal/lib/live/CLAUDE.md`? · `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/DESIGN.md`? · `portal/src/portal/newui/assessment/CLAUDE.index.md`? · `portal/src/portal/newui/assessment/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/coaching/CLAUDE.index.md`? · `portal/src/portal/newui/coaching/CLAUDE.md`? · `portal/src/portal/pages/CLAUDE.index.md`? · `portal/src/portal/teacher/coaching/CLAUDE.index.md`? · `portal/src/portal/teacher/coaching/CLAUDE.md`?
