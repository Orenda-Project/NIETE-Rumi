# assess — Coach Learning-assessment support: results maths, copy, offline visit store
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/lib/assess kg=3641db5ce7cc gen=19b1edd553ee overflow=40 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `copy.ts` — all coach-facing en/ur strings; dashboardCopy.ts and reviewCopy.ts follow the same shape
- `cohortStats.ts` — dashboard numbers from SaTaskResult; realCohort.ts maps live sessions into it
- Tests sit beside sources (*.test.ts(x)), vitest jsdom: `cd portal && npx vitest run src/portal/lib/assess`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | All coach-facing Urdu/English strings for the Learning assessment page, plus Urdu-digit and bidi helpers |
| `blocks.ts` | Learning assessment: which battery block (B1..B5, full, RDF variants) a child takes; rotates by Pakistan day |
| `visitStore.ts` | localStorage memory of one assessment visit (per school and PKT day): queued outcomes, mic check, children done |
| … | 20 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/components/assess/AssessEngineSlot.tsx:2:c94dcd90` · `portal/src/portal/components/assess/AssessOtherPhone.tsx:4:71d3bb00` (+8)
- `visitStore.ts` ← imported by `portal/src/portal/components/assess/AssessOfflineCard.tsx:4:e86a76f0` · `portal/src/portal/components/assess/AssessPreflight.tsx:4:38086f51` (+4)
- `blocks.ts` ← imported by `portal/src/portal/components/assess/AssessEngineSlot.tsx:3:91b77f58` · `portal/src/portal/components/assess/AssessOtherPhone.tsx:5:91b77f58` (+2)
- … 14 more → `CLAUDE.index.md`

## Never (human)
- en and ur copy must carry every key, Urdu digits for numbers (copy.ts:8)
- Groups of 1-4 children show <5 and no numbers (realCohort.ts:9, MIN_CELL at :13)
- Switches fail CLOSED: off until read, and when unreadable (switches.ts:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/lib/assess/cohortStats.test.ts` (cohortStats.ts, exampleCohort.ts, rwpNorms.ts)
- `portal/src/portal/lib/assess/realCohort.test.ts` (cohortStats.ts, realCohort.ts)
- … 8 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/lib/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
