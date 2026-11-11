# coaching — Old-UI teacher Coaching pieces: record/send panel, lesson page, library picker
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/coaching kg=e0939dacaa9c gen=3d42434f895f overflow=21 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `CoachingHome.tsx` — older Coaching home (new UI uses newui/coaching/CoachingMain)
- `LessonPage.tsx` — one coached lesson page; tests: `cd portal && npx vitest run src/portal/components/coaching` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `coach/` | → (no door; 2 files) |
| `BottomSheet.tsx` | bd-5rz1v: sheet rising from screen bottom for one decision (Finish recording?, Add lesson plan) |
| `CoachingHome.tsx` | Older teacher Coaching home: send-a-lesson entry, lesson list, needs-answer banner, live-moves eligibility |
| `LibraryPicker.tsx` | bd-5rz1v: "From our library" lesson-plan chooser: recent plans, then grade, subject, chapter, lesson |
| `BottomSheet.test.tsx` | bd-5rz1v.8: BottomSheet carries role=dialog data-state=open so Android Back closes it first |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `BottomSheet.tsx` ← imported by `portal/src/portal/lib/recordingSession.tsx:2:5cee5b11` · `portal/src/portal/pages/LeaderObserveDraft.tsx:6:5cee5b11` (+3)
- `CoachingHome.tsx` ← imported by `portal/src/portal/newui/coaching/CoachingMain.tsx:5:834bd6a7` · `portal/src/portal/newui/coaching/useSendFlow.ts:3:834bd6a7` (+2)
- `LibraryPicker.tsx` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:13:21554af0` · `portal/src/portal/pages/LeaderObserveRecord.tsx:11:a2b5b96a` (+1)
- `NeedsAnswerBanner.tsx` ← imported by `portal/src/portal/components/coaching/CoachingHome.tsx:5:5f4621d4` · `portal/src/portal/components/coaching/LessonPage.tsx:5:5f4621d4`
- … 7 more → `CLAUDE.index.md`

## Never (human)
- Overlays must be role=dialog data-state=open so the Back key closes them first (BottomSheet.tsx:28, bd-5rz1v.8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/coaching/BottomSheet.test.tsx` (BottomSheet.tsx)
- `portal/src/portal/components/coaching/CoachingHome.live.test.tsx` (CoachingHome.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/CLAUDE.md`?
