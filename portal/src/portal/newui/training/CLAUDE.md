# training — New-UI Training screens: providers, levels, parts, quizzes, exams, certificates
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/training kg=7455a2f7d94f gen=6103a2527f6f overflow=55 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `TrainingHome.tsx` — providers, Continue, certificates, My grades entries
- `trainingApi.ts` — shared client over PortalTrainingV2; tests: `cd portal && npx vitest run src/portal/newui/training` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `trainingApi.ts` | bd-5rz1v.25: shared client and types for new Training screens over PortalTrainingV2 endpoints |
| `frame.tsx` | bd-5rz1v.25: shared Training page frame (light bar, spacing); TrainingFrameContext lets v2 swap it |
| `TrainingLevelExam.test.tsx` | bd-5rz1v.25: level exam Ready hero with rule chips, other gate states, one question per screen |
| `certificateFile.ts` | bd-5rz1v.25: opens/saves a certificate PDF through a real anchor, outcome saved or failed (bd-2397) |
| … | 28 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `trainingApi.ts` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:20:c1416825` · `portal/src/portal/coach/training/libraryApi.ts:1:3cc0f2b4` (+23)
- `frame.tsx` ← imported by `portal/src/portal/teacher/training/TrainingFrame.tsx:5:f09838a9` · `portal/src/portal/newui/training/TrainingCertificates.tsx:10:3604d4c0` (+9)
- `certificateFile.ts` ← imported by `portal/src/portal/components/CertificatesPanel.tsx:53:05801542` · `portal/src/portal/teacher/training/CertificatesPage.tsx:6:f065c924` (+6)
- … 12 more → `CLAUDE.index.md`

## Never (human)
- Locks, gates and pass marks come from the server, not the portal (trainingApi.ts:7-8, bd-5rz1v.25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/newui/training/TrainingLevelExam.test.tsx`? (TrainingLevelExam.tsx, trainingApi.ts)
- `portal/src/portal/newui/training/continue.test.ts` (continue.ts, trainingApi.ts)
- … 15 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/training/CLAUDE.index.md`? · `portal/src/portal/newui/training/CLAUDE.md`? · `portal/src/portal/pages/CLAUDE.index.md`? (+2)
