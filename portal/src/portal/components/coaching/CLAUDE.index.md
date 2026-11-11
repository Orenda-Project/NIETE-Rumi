# coaching — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/components/coaching -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `coach/` | → (no door; 2 files) |
| `AttentionDot.tsx` | bd-5rz1v: red pulsing dot meaning "this needs you", used on coaching lessons awaiting an answer |
| `BottomSheet.test.tsx` | bd-5rz1v.8: BottomSheet carries role=dialog data-state=open so Android Back closes it first |
| `BottomSheet.tsx` | bd-5rz1v: sheet rising from screen bottom for one decision (Finish recording?, Add lesson plan) |
| `ChalkboardIcon.tsx` | bd-5rz1v.7: chalkboard-on-easel icon for the Send a lesson button |
| `CoachingHome.live.test.tsx` | bd-v0toag.31.1: older Coaching home checks live-moves eligibility on arrival, off Record's path |
| `CoachingHome.tsx` | Older teacher Coaching home: send-a-lesson entry, lesson list, needs-answer banner, live-moves eligibility |
| `LessonPage.tsx` | bd-5rz1v: one page per coached lesson, always openable, showing analysis state, plan and feedback |
| `LibraryPicker.recent.test.tsx` | bd-5rz1v.6: LibraryPicker shows recent plans first; a coach passes the observed teacher's loader |
| `LibraryPicker.tsx` | bd-5rz1v: "From our library" lesson-plan chooser: recent plans, then grade, subject, chapter, lesson |
| `NeedsAnswerBanner.tsx` | bd-5rz1v: navy edge-to-edge bar "N lessons need your answer" opening the oldest waiting lesson |
| `RecordIcon.tsx` | bd-5rz1v: red record-button icon (dot, mic, ripples), still under reduced-motion |
| `SendLessonButton.test.tsx` | bd-5rz1v.9: Send a lesson reads as a tappable row button (chosen mockup), not a banner |
| `SendLessonButton.tsx` | bd-5rz1v.7: green "Send a lesson to your Digital Coach" button that opens SendLessonSheet |
| `SendLessonSheet.tsx` | bd-5rz1v.7: sheet with the two ways to send a lesson: Record Live Lecture (if mic works) or upload |
| `SoundBars.tsx` | bd-5rz1v: moving sound bars while recording, following mic level when available, flat when paused |

## Who reads this (all, generated)
- `AttentionDot.tsx` ← imported by `portal/src/portal/components/coaching/NeedsAnswerBanner.tsx:2:3539465b`
- `BottomSheet.tsx` ← imported by `portal/src/portal/lib/recordingSession.tsx:2:5cee5b11` · `portal/src/portal/pages/LeaderObserveDraft.tsx:6:5cee5b11` · `portal/src/portal/pages/LeaderObserveRecord.tsx:10:5cee5b11` · `portal/src/portal/pages/PortalCoachingRecord.tsx:10:5cee5b11` (+1: `python3 kg/kg.py who-reads BottomSheet.tsx`)
- `ChalkboardIcon.tsx` ← imported by `portal/src/portal/components/coaching/SendLessonButton.tsx:2:724bd433`
- `CoachingHome.tsx` ← imported by `portal/src/portal/newui/coaching/CoachingMain.tsx:5:834bd6a7` · `portal/src/portal/newui/coaching/useSendFlow.ts:3:834bd6a7` · `portal/src/portal/pages/PortalCoaching.tsx:15:acd2e5d7` · `portal/src/portal/pages/PortalCoachingRecord.tsx:20:1f5b6183`
- `LessonPage.tsx` ← imported by `portal/src/portal/pages/PortalCoachingDetail.tsx:16:92dcd2ce`
- `LibraryPicker.tsx` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:13:21554af0` · `portal/src/portal/pages/LeaderObserveRecord.tsx:11:a2b5b96a` · `portal/src/portal/pages/PortalCoachingRecord.tsx:13:a2b5b96a`
- `NeedsAnswerBanner.tsx` ← imported by `portal/src/portal/components/coaching/CoachingHome.tsx:5:5f4621d4` · `portal/src/portal/components/coaching/LessonPage.tsx:5:5f4621d4`
- `RecordIcon.tsx` ← imported by `portal/src/portal/pages/LeaderObserveTalk.tsx:8:00c65e2a` · `portal/src/portal/components/coaching/SendLessonSheet.tsx:4:c6c7407e`
- `SendLessonButton.tsx` ← imported by `portal/src/portal/pages/LeaderObservations.tsx:6:9eaac3a3` · `portal/src/portal/components/coaching/CoachingHome.tsx:6:7928aa79`
- `SendLessonSheet.tsx` ← imported by `portal/src/portal/pages/LeaderObserveRecord.tsx:13:08a4d639` · `portal/src/portal/components/coaching/CoachingHome.tsx:7:2acf3876`
- `SoundBars.tsx` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:11:a7c3968c` · `portal/src/portal/components/coaching/coach/CoachRecorder.tsx:3:49769f41`

## Tests (all, generated)
- `BottomSheet.tsx` ← `portal/src/portal/components/coaching/BottomSheet.test.tsx`
- `CoachingHome.tsx` ← `portal/src/portal/components/coaching/CoachingHome.live.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.session.test.tsx`
- `LibraryPicker.tsx` ← `portal/src/portal/components/coaching/LibraryPicker.recent.test.tsx`
- `SendLessonButton.tsx` ← `portal/src/portal/components/coaching/SendLessonButton.test.tsx`

## Related (all, generated)
- docs: `portal/CLAUDE.md`?
