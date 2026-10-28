# coaching — New-UI teacher Coaching: record page, lesson view, live moves, send flow
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/coaching kg=4cd59eacb28e gen=ed72c9ef9e0c overflow=56 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `RecordPage.tsx` — record or upload a lesson, then check and send
- `useLiveMoves.ts` — live moves hook for group D; tests: `cd portal && npx vitest run src/portal/newui/coaching` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `RecordPage*` | 3 files; most used `RecordPage.test.tsx`: bd-5rz1v.26: /portal/coaching/new new-UI record then check-and-send flow, route state from Coaching |
| `CoachingMain.test.tsx` | bd-5rz1v.26: new Coaching main page (band, lesson list, which Coaching she gets by flags) |
| `CLAUDE.index.md` | (unmapped) |
| `RecordingBar.newUi.test.tsx` | bd-5rz1v.26/.24: recording bar restyled for the new menu, and never overlapping a page's bottom button |
| … | 24 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `useSendFlow.ts` ← imported by `portal/src/portal/pages/legacyLive.ts:2:0faa2c0f` · `portal/src/portal/teacher/coaching/NewObservation.tsx:19:27d04c12` (+4)
- `pickerWords.ts` ← imported by `portal/src/portal/teacher/coaching/copy.ts:19:6c7e6daa` · `portal/src/portal/newui/coaching/LibraryStep.tsx:11:1d044371` (+3)
- … 16 more → `CLAUDE.index.md`

## Never (human)
- Live moves only read: a refusal or failed detect never touches the recording (useLiveMoves.ts:12, bd-v0toag.31)
- Live-move ticks only say done: no 'missed', no red (LiveMovesList.tsx:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/coaching/picker.ur.test.tsx` (LibraryStep.tsx, PlanSheet.tsx, coachingApi.ts, useSendFlow.ts)
- `portal/src/portal/newui/coaching/LiveMovesList.test.tsx` (LiveMovesList.tsx, MoveTapSheet.tsx)
- … 16 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/components/coaching/CLAUDE.index.md`? · `portal/src/portal/fln/share/CLAUDE.index.md`? · `portal/src/portal/fln/share/CLAUDE.md`? · `portal/src/portal/fln/tests/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.index.md`? (+14)
