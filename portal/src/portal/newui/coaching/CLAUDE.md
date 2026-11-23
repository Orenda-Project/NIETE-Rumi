# coaching — New-UI teacher Coaching: record page, lesson view, live moves, send flow
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/coaching kg=1022c87e81a9 gen=3daa1c3d8c9d overflow=55 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `RecordPage.tsx` — record or upload a lesson, then check and send
- `useLiveMoves.ts` — live moves hook for group D; tests: `cd portal && npx vitest run src/portal/newui/coaching` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `RecordPage*` | 3 files; most used `RecordPage.test.tsx`: bd-5rz1v.26: /portal/coaching/new new-UI record then check-and-send flow, route state from Coaching |
| `CoachingMain.test.tsx` | bd-5rz1v.26: new Coaching main page (band, lesson list, which Coaching she gets by flags) |
| `useSendFlow.ts` | Hook running the record, check and send stages for a lesson (recorder, plan pick, upload) for RecordPage |
| … | 25 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `useSendFlow.ts` ← imported by `portal/src/portal/pages/legacyLive.ts:2:0faa2c0f` · `portal/src/portal/teacher/coaching/NewObservation.tsx:21:27d04c12` (+4)
- `pickerWords.ts` ← imported by `portal/src/portal/teacher/coaching/copy.ts:19:6c7e6daa` · `portal/src/portal/newui/coaching/LibraryStep.tsx:11:1d044371` (+3)
- `useLiveMoves.ts` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:27:21db6050` · `portal/src/portal/teacher/coaching/NewObservation.tsx:20:0c3ada55` (+3)
- … 15 more → `CLAUDE.index.md`

## Never (human)
- Live moves only read: a refusal or failed detect never touches the recording (useLiveMoves.ts:12, bd-v0toag.31)
- Live-move ticks only say done: no 'missed', no red (LiveMovesList.tsx:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/coaching/picker.ur.test.tsx` (LibraryStep.tsx, PlanSheet.tsx, coachingApi.ts, useSendFlow.ts)
- `portal/src/portal/newui/coaching/LiveMovesList.test.tsx` (LiveMovesList.tsx, MoveTapSheet.tsx)
- … 17 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/lib/CLAUDE.md`? · `portal/src/portal/lib/live/CLAUDE.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/DESIGN.md`? · `portal/src/portal/newui/checks/CLAUDE.md`?
