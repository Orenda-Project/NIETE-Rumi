# assessment — New-UI Assessment screens: make a paper, writing/ready/failed, My assessments
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/assessment kg=7ce5ed0dd9b4 gen=84dc256cfbaa overflow=9 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `AssessmentHome.tsx` — class, subject, chapter, count, then Make assessment
- `assessmentApi.ts` — shared polling, gate and download helpers; tests: `cd portal && npx vitest run src/portal/newui/assessment` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assessmentApi.ts` | bd-5rz1v.13: shared Assessment helpers: polling constants, useAssessmentGate, failure labels, downloadArtifact |
| `AssessmentRequest.test.tsx` | bd-5rz1v.13: Writing, polling, Ready and Failed states after Make assessment |
| `AssessmentHome.test.tsx` | bd-5rz1v.13: Assessment page band, Class/Subject/Chapter sheets, Questions stepper, Make assessment |
| `assessmentApi.test.ts` | bd-5rz1v.13: eleven failure codes to labels, opening a file, downloadArtifact, banned old words |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `assessmentApi.ts` ← imported by `portal/src/portal/newui/coaching/LessonView.tsx:25:f55de06e` · `portal/src/portal/newui/home/HomeList.tsx:20:d056c9e3` (+7)
- `MyAssessments.tsx` ← imported by `portal/src/portal/newui/home/HomeList.tsx:21:bed84c85` · `portal/src/portal/pages/PortalAssessment.tsx:10:f71c328a`
- `AssessmentHome.tsx` ← imported by `portal/src/portal/pages/PortalAssessment.tsx:8:47bb8a7c`
- `AssessmentRequest.tsx` ← imported by `portal/src/portal/pages/PortalAssessment.tsx:9:7db4fad1`

## Never (human)
- Assessment rules (grades, types, question cap) come from /assessment/options, never hardcoded (assessmentApi.ts:11-12)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/newui/assessment/AssessmentHome.test.tsx` (AssessmentHome.tsx, assessmentApi.ts)
- `portal/src/portal/newui/assessment/AssessmentRequest.test.tsx` (AssessmentRequest.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/assessment/CLAUDE.index.md`? · `portal/src/portal/newui/assessment/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? (+1)
