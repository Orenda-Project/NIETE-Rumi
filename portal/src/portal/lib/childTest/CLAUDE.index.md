# childTest — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/lib/childTest -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `blockMachine.test.ts` | bd-s1oo0.7: pins blockMachine reducer: Start, 60s countdown with one tone, early finish, review, send, retry |
| `blockMachine.ts` | bd-s1oo0.7: pure reducer for one child-test block (ready, recording, review, sending, sent) with the timed minute |
| `checkDraft.test.ts` | bd-s1oo0.7: pins checkDraft: confident values kept, doubtful left empty, ai_marks-shaped coach marks, empty form |
| `checkDraft.ts` | bd-s1oo0.7: builds the coach's check-form draft from the bot prefill and converts it back to ai_marks coach marks |
| `copy.test.ts` | bd-s1oo0.7: pins child-test copy.ts: en/ur same keys, no roll numbers, no gendered Urdu forms for coach/child |
| `copy.ts` | bd-s1oo0.7: Urdu/English, gender-neutral coach-facing strings for the child-test page |
| `recordings.ts` | bd-s1oo0.7: IndexedDB chunk store for child-test recordings and maths-strip photos until they reach R2 |
| `tone.ts` | bd-s1oo0.7: playTone, the WebAudio beep and vibration at the 60-second mark; never throws |
| `uploader.test.ts` | bd-s1oo0.7: pins uploader.ts: presign, PUT, register, delete copy; network or 4xx failure keeps the item |
| `uploader.ts` | bd-s1oo0.7: uploads a stored child-test item (presign, PUT to R2, attach to block); deletes the copy only on success |

## Who reads this (all, generated)
- `blockMachine.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:5:e19d3107`
- `checkDraft.ts` ← imported by `portal/src/portal/components/childTest/CheckForm.tsx:5:49155ebb`
- `copy.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:4:9a63f4a8` · `portal/src/portal/components/childTest/CheckForm.tsx:4:9a63f4a8` · `portal/src/portal/components/childTest/StimulusCard.tsx:2:9a63f4a8` · `portal/src/portal/pages/LeaderChildTest.tsx:12:d2a12d48`
- `recordings.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:6:7495a682` · `portal/src/portal/pages/LeaderChildTest.tsx:11:06bc2915` · `portal/src/portal/lib/childTest/uploader.ts:10:87da1786`
- `tone.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:11:bb62f03a`
- `uploader.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:7:2d5b0c3b` · `portal/src/portal/pages/LeaderChildTest.tsx:10:efa4c200`

## Tests (all, generated)
- `blockMachine.ts` ← `portal/src/portal/lib/childTest/blockMachine.test.ts`
- `checkDraft.ts` ← `portal/src/portal/lib/childTest/checkDraft.test.ts`
- `copy.ts` ← `portal/src/portal/components/childTest/BlockRecorder.test.tsx` · `portal/src/portal/components/childTest/StimulusCard.test.tsx` · `portal/src/portal/lib/childTest/copy.test.ts`
- `recordings.ts` ← `portal/src/portal/components/childTest/BlockRecorder.test.tsx` · `portal/src/portal/lib/childTest/uploader.test.ts`
- `uploader.ts` ← `portal/src/portal/lib/childTest/uploader.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/lib/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
