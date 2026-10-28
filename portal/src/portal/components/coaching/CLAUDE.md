# coaching — Old-UI teacher Coaching pieces: record/send panel, lesson page, library picker
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/coaching kg=e0939dacaa9c gen=0b297ed65b69 overflow=23 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `CLAUDE.index.md` | (unmapped) |
| `LibraryPicker.tsx` | bd-5rz1v: "From our library" lesson-plan chooser: recent plans, then grade, subject, chapter, lesson |
| `BottomSheet.test.tsx` | bd-5rz1v.8: BottomSheet carries role=dialog data-state=open so Android Back closes it first |
| … | 12 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `BottomSheet.tsx` ← imported by `portal/src/portal/lib/recordingSession.tsx:2:5cee5b11` · `portal/src/portal/pages/LeaderObserveDraft.tsx:6:5cee5b11` (+3)
- `CoachingHome.tsx` ← imported by `portal/src/portal/newui/coaching/CoachingMain.tsx:5:834bd6a7` · `portal/src/portal/newui/coaching/useSendFlow.ts:3:834bd6a7` (+2)
- `LibraryPicker.tsx` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:13:21554af0` · `portal/src/portal/pages/LeaderObserveRecord.tsx:11:a2b5b96a` (+1)
- … 8 more → `CLAUDE.index.md`

## Never (human)
- Overlays must be role=dialog data-state=open so the Back key closes them first (BottomSheet.tsx:28, bd-5rz1v.8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/coaching/BottomSheet.test.tsx` (BottomSheet.tsx)
- `portal/src/portal/components/coaching/CoachingHome.live.test.tsx` (CoachingHome.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/CLAUDE.index.md`? · `portal/CLAUDE.md`? · `portal/src/lib/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.md`? · `portal/src/portal/components/coaching/CLAUDE.index.md`? (+4)
