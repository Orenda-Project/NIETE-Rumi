# training — Teacher Training v2: hub, providers, levels, courses, parts, quizzes, exams, certificates
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/training kg=54f043ae8661 gen=1ca932d28566 overflow=35 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `TrainingHub.tsx` — main page; `routes.tsx` — page map; `model.ts` — pure shaping of /training/* reads
- `parts.tsx` and `inner.ts` — shared pieces; hooks and rules live in ../../newui/training
- `model.test.ts` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/training`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `TrainingFrame.tsx` | Shared v2 Training page frame (TeacherPage with Training tile) plus LoadState, EmptyNote, ProviderMark and ProviderTile |
| `copy.ts` | English and Urdu words for Training screens plus TRAINING_INNER, the reused new-UI training words, as COPY_ENTRIES |
| `model.ts` | Pure Training model: TRAINING_V2_BASE, provider logos, teaching levels, course tiles and certificate shaping |
| `parts.tsx` | Shared v2 Training pieces: V2Row, HeroCard, dock buttons, question dots, answer choices, written box, certificate card |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/card/training.tsx:7:6f69a157` · `portal/src/portal/coach/training/LibraryPages.tsx:15:9880e121` (+12)
- `TrainingFrame.tsx` ← imported by `portal/src/portal/coach/card/training.tsx:9:6a7c6c5a` · `portal/src/portal/coach/training/LibraryPages.tsx:18:18ea215e` (+10)
- `model.ts` ← imported by `portal/src/portal/coach/card/training.tsx:8:b8769381` · `portal/src/portal/coach/card/types.ts:7:6254b274` (+7)
- … 12 more → `CLAUDE.index.md`

## Never (human)
- Locks, gates and pass marks stay the server's; this folder only restyles (model.ts:14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/training/checks.test.tsx` (TrainingFrame.tsx, copy.ts, model.ts, parts.tsx, routes.tsx)
- `portal/src/portal/teacher/training/training.ur.test.tsx` (TrainingFrame.tsx, TrainingHub.tsx, copy.ts, parts.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`?
