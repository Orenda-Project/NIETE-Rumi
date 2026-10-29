# childTest — Coach child-test block machine, check form, local recordings and uploader
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/lib/childTest kg=0e917685948b gen=8f7ebb4b0d92 overflow=12 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `blockMachine.ts` — pure reducer for one block (ready, recording, review, sending, sent)
- `uploader.ts` — presign, PUT to R2, attach to block; copy deleted only on success
- Tests sit beside sources (*.test.ts(x)), vitest jsdom: `cd portal && npx vitest run src/portal/lib/childTest`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | bd-s1oo0.7: Urdu/English, gender-neutral coach-facing strings for the child-test page |
| `recordings.ts` | bd-s1oo0.7: IndexedDB chunk store for child-test recordings and maths-strip photos until they reach R2 |
| `checkDraft.test.ts` | bd-s1oo0.7: pins checkDraft: confident values kept, doubtful left empty, ai_marks-shaped coach marks, empty form |
| `uploader.ts` | bd-s1oo0.7: uploads a stored child-test item (presign, PUT to R2, attach to block); deletes the copy only on success |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:4:9a63f4a8` · `portal/src/portal/components/childTest/CheckForm.tsx:4:9a63f4a8` (+2)
- `recordings.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:6:7495a682` · `portal/src/portal/pages/LeaderChildTest.tsx:11:06bc2915` (+1)
- `uploader.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:7:2d5b0c3b` · `portal/src/portal/pages/LeaderChildTest.tsx:10:efa4c200`
- `blockMachine.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:5:e19d3107`
- … 2 more → `CLAUDE.index.md`

## Never (human)
- en and ur copy must carry every key, with no gendered Urdu forms (copy.ts:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/childTest/BlockRecorder.test.tsx` (copy.ts, recordings.ts)
- `portal/src/portal/lib/childTest/uploader.test.ts` (recordings.ts, uploader.ts)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/lib/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
