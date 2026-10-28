# training — Teacher Training v2: hub, providers, levels, courses, parts, quizzes, exams, certificates
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/training kg=bf167a367cef gen=4b68999b156f overflow=39 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `parts.tsx` | Shared v2 Training pieces: V2Row, HeroCard, dock buttons, question dots, answer choices, written box, certificate card |
| … | 20 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:15:9880e121` · `portal/src/portal/teacher/training/CertificatesPage.tsx:4:3bfefe66` (+11)
- `TrainingFrame.tsx` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:18:18ea215e` · `portal/src/portal/teacher/training/CertificatesPage.tsx:13:5909f538` (+9)
- … 13 more → `CLAUDE.index.md`

## Never (human)
- Locks, gates and pass marks stay the server's; this folder only restyles (model.ts:14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/training/checks.test.tsx` (TrainingFrame.tsx, copy.ts, model.ts, parts.tsx, routes.tsx)
- `portal/src/portal/teacher/training/training.ur.test.tsx` (TrainingFrame.tsx, TrainingHub.tsx, copy.ts, parts.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/training/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? (+2)
