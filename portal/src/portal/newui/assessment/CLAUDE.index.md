# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/newui/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AssessmentHome.test.tsx` | bd-5rz1v.13: Assessment page band, Class/Subject/Chapter sheets, Questions stepper, Make assessment |
| `AssessmentHome.tsx` | New-UI Assessment main page: pick class, subject, chapter, question count and types, then Make assessment |
| `AssessmentRequest.test.tsx` | bd-5rz1v.13: Writing, polling, Ready and Failed states after Make assessment |
| `AssessmentRequest.tsx` | New-UI page after Make assessment: Hero while writing, polls job to Ready with download, or Failed label |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `MyAssessments.test.tsx` | bd-5rz1v.13: My assessments filter chips, per-paper rows with download, paging from GET /assessment/papers |
| `MyAssessments.tsx` | New-UI My assessments list: class/subject filters, paper rows with download, paging, PaperSheet detail |
| `assessmentApi.test.ts` | bd-5rz1v.13: eleven failure codes to labels, opening a file, downloadArtifact, banned old words |
| `assessmentApi.ts` | bd-5rz1v.13: shared Assessment helpers: polling constants, useAssessmentGate, failure labels, downloadArtifact |

## Who reads this (all, generated)
- `AssessmentHome.tsx` ← imported by `portal/src/portal/pages/PortalAssessment.tsx:8:47bb8a7c`
- `AssessmentRequest.tsx` ← imported by `portal/src/portal/pages/PortalAssessment.tsx:9:7db4fad1`
- `MyAssessments.tsx` ← imported by `portal/src/portal/newui/home/HomeList.tsx:21:bed84c85` · `portal/src/portal/pages/PortalAssessment.tsx:10:f71c328a`
- `assessmentApi.ts` ← imported by `portal/src/portal/newui/coaching/LessonView.tsx:25:f55de06e` · `portal/src/portal/newui/home/HomeList.tsx:20:d056c9e3` · `portal/src/portal/teacher/assessment/PaperPage.tsx:7:438f2339` · `portal/src/portal/teacher/assessment/RequestPage.tsx:14:438f2339` (+5: `python3 kg/kg.py who-reads assessmentApi.ts`)

## Tests (all, generated)
- `AssessmentHome.tsx` ← `portal/src/portal/newui/assessment/AssessmentHome.test.tsx`
- `AssessmentRequest.tsx` ← `portal/src/portal/newui/assessment/AssessmentRequest.test.tsx`
- `MyAssessments.tsx` ← `portal/src/portal/newui/assessment/MyAssessments.test.tsx`
- `assessmentApi.ts` ← `portal/src/portal/newui/assessment/AssessmentHome.test.tsx` · `portal/src/portal/newui/assessment/assessmentApi.test.ts` · `portal/src/portal/newui/coaching/LessonView.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/assessment/CLAUDE.index.md`? · `portal/src/portal/newui/assessment/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/coaching/CLAUDE.index.md`?
