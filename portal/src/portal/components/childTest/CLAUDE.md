# childTest — Coach-app child reading/maths test: stimulus, recorder, 'what Rumi heard' form

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/childTest kg=ca29ae702eea gen=373277972164 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `BlockRecorder.tsx` — one block: Start, 60 s countdown, record, re-record, Send
- `StimulusCard.tsx` — what the child reads in large print; tests: `cd portal && npx vitest run src/portal/components/childTest` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `BlockRecorder.test.tsx` | bd-s1oo0.7: BlockRecorder reading and maths blocks: Start, 60 s countdown tone, Stop, re-record, Send |
| `StimulusCard.test.tsx` | bd-s1oo0.7: stimulus keeps inline direction so Urdu page does not flip "5 - 1" or right-align English |
| `BlockRecorder.tsx` | bd-s1oo0.7: coach-app child test block: card, big Start, 60-second countdown, record, re-record and Send |
| `StimulusCard.tsx` | bd-s1oo0.7: child-facing reading/maths stimulus in large print (story, sums, number strip), Nastaliq for Urdu |
| `CheckForm.tsx` | bd-s1oo0.7: "What Rumi heard" check form: prefilled counts, wrong-word chips, verdict buttons, empty if unsure |

## Who reads this (generated)
- `BlockRecorder.tsx` ← imported by `portal/src/portal/pages/LeaderChildTest.tsx:5:ace70f31`
- `CheckForm.tsx` ← imported by `portal/src/portal/pages/LeaderChildTest.tsx:6:bd263fc6`
- `StimulusCard.tsx` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:13:8b324fbd`

## Never (human)
- Child-facing elements set text direction inline; global [dir=rtl] CSS flipped '5 - 1' (StimulusCard.test.tsx:10, bd-s1oo0.7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/childTest/BlockRecorder.test.tsx` (BlockRecorder.tsx)
- `portal/src/portal/components/childTest/StimulusCard.test.tsx` (StimulusCard.tsx)

## Related (generated)
- docs: `portal/src/portal/lib/childTest/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
