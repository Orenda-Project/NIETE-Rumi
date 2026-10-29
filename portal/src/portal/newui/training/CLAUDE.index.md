# training — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/newui/training -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `TrainingCertificates.test.tsx` | bd-5rz1v.25: Training Certificates list with provider filter chips, View and Download follow CertificatesPanel |
| `TrainingCertificates.tsx` | New-UI Training certificates page: provider filter chips, one row per certificate with download |
| `TrainingCourse.test.tsx` | bd-5rz1v.25: a course's parts list (Part not module) and I-SAPS module exam row and Required reading |
| `TrainingCourse.tsx` | New-UI course page listing its parts with progress, I-SAPS module exam row and readings |
| `TrainingGrades.test.tsx` | bd-5rz1v.25: My grades toggle list, 48h lock chip from can_change/hours_remaining, Save |
| `TrainingGrades.tsx` | New-UI My grades (BandPicker in the kit): pick grade bands, server-enforced 48 hour lock after save |
| `TrainingHome.test.tsx` | bd-5rz1v.25: Training main page heading, provider rows and Continue |
| `TrainingHome.tsx` | New-UI Training main page: providers, Continue where she left off, certificates and My grades entries |
| `TrainingLevel.test.tsx` | bd-5rz1v.25: a level page: exam row (locked/Ready), courses with progress, I-SAPS certificate row |
| `TrainingLevel.tsx` | New-UI level page: level exam row on top, courses with progress chips, level certificate and capstone result |
| `TrainingLevelExam.test.tsx` | bd-5rz1v.25: level exam Ready hero with rule chips, other gate states, one question per screen |
| `TrainingLevelExam.tsx` | New-UI level (grand-quiz) exam, one question per screen, posting the same payload as LevelExamCard |
| `TrainingLevels.test.tsx` | bd-5rz1v.25: provider levels page: NIETE ladder versus Beacon House subjects in any order |
| `TrainingLevels.tsx` | New-UI /portal/training/provider/:vendorKey page: one row per level of a provider |
| `TrainingModuleExam.test.tsx` | bd-5rz1v.25: I-SAPS module exam first sitting, written questions with no options, one question per screen |
| `TrainingModuleExam.tsx` | New-UI I-SAPS module exam at /portal/training/exam/:courseId, MCQ plus written answers, per screen |
| `TrainingPart.test.tsx` | bd-5rz1v.25: a part page: chips, video, audio, handout PDF, Start quick check or Mark done |
| `TrainingPart.tsx` | New-UI training part page: video, audio, handout, Quick check entry or Mark done |
| `TrainingQuiz.test.tsx` | bd-5rz1v.25/bd-klecr.6: quick check one question per screen, Check verdict, the paper is the attempt's |
| `TrainingQuiz.tsx` | New-UI quick check (module quiz) one question per screen; quickCheckNext picks the next route |
| `certificateFile.test.ts` | bd-4ryvw: downloadCertificate saves the PDF without leaving the portal (signed R2 redirect in WebView) |
| `certificateFile.ts` | bd-5rz1v.25: opens/saves a certificate PDF through a real anchor, outcome saved or failed (bd-2397) |
| `continue.test.ts` | bd-5rz1v.25: findContinue picks the course with her latest part completed_at |
| `continue.ts` | bd-5rz1v.25: findContinue derives where "Continue provider" goes from existing training endpoints' completed_at |
| `courseName.test.ts` | bd-fmf24g.32: courseName strips the "Module N - " prefix teachers never see |
| `examParts.tsx` | bd-5rz1v.25: shared exam pieces: CertificateCard, WrittenField with character floor, written answer readback |
| `frame.tsx` | bd-5rz1v.25: shared Training page frame (light bar, spacing); TrainingFrameContext lets v2 swap it |
| `legacyProviderName.test.ts` | bd-s42dye.7: legacy TALEEMABAD_LEGACY provider reads "NIETE Archive" when the server sends no name |
| `providerNames.test.ts` | bd-2gia5l: provider labels come from training_vendors.name, not hardcoded; providerShort and initials |
| `trainingApi.ts` | bd-5rz1v.25: shared client and types for new Training screens over PortalTrainingV2 endpoints |

## Who reads this (all, generated)
- `TrainingCertificates.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:17:04bed4d2` · `portal/src/portal/teacher/training/CertificatesPage.tsx:7:27db4004`
- `TrainingCourse.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:12:e7676f64` · `portal/src/portal/teacher/training/CoursePage.tsx:5:2ee83bb0`
- `TrainingGrades.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:18:d69bee29` · `portal/src/portal/teacher/training/GradesPage.tsx:5:90de952b`
- `TrainingHome.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:9:aa6e61ca`
- `TrainingLevel.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:11:b66d3892` · `portal/src/portal/teacher/training/LevelExamPage.tsx:4:5405095f` · `portal/src/portal/teacher/training/TrainingLevelPage.tsx:5:5dbc8c0b`
- `TrainingLevelExam.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:15:a70e815e` · `portal/src/portal/teacher/training/LevelExamPage.tsx:5:81c207c5`
- `TrainingLevels.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:10:c74443a4`
- `TrainingModuleExam.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:16:14539dd1` · `portal/src/portal/teacher/training/ModuleExamPage.tsx:5:d043dd11`
- `TrainingPart.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:13:4735a0ae` · `portal/src/portal/teacher/training/PartPage.tsx:8:d2003a95`
- `TrainingQuiz.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:14:71837fb5` · `portal/src/portal/teacher/training/QuickCheckPage.tsx:5:b74c897a`
- `certificateFile.ts` ← imported by `portal/src/portal/components/CertificatesPanel.tsx:53:05801542` · `portal/src/portal/teacher/training/CertificatesPage.tsx:6:f065c924` · `portal/src/portal/teacher/training/PartPage.tsx:7:f07dd54e` · `portal/src/portal/teacher/training/parts.tsx:9:41e01a61` (+4: `python3 kg/kg.py who-reads certificateFile.ts`)
- `continue.ts` ← imported by `portal/src/portal/teacher/training/TrainingHub.tsx:6:7e20696d` · `portal/src/portal/teacher/training/model.ts:10:616e5cad` · `portal/src/portal/newui/training/TrainingHome.tsx:13:bcc0f62f`
- `examParts.tsx` ← imported by `portal/src/portal/newui/training/TrainingLevelExam.tsx:13:b5d8d89c` · `portal/src/portal/newui/training/TrainingModuleExam.tsx:14:50c62726`
- `frame.tsx` ← imported by `portal/src/portal/teacher/training/TrainingFrame.tsx:5:f09838a9` · `portal/src/portal/newui/training/TrainingCertificates.tsx:10:3604d4c0` · `portal/src/portal/newui/training/TrainingCourse.tsx:10:6d229a0a` · `portal/src/portal/newui/training/TrainingGrades.tsx:9:6d229a0a` (+7: `python3 kg/kg.py who-reads frame.tsx`)
- `trainingApi.ts` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:20:c1416825` · `portal/src/portal/coach/training/libraryApi.ts:1:3cc0f2b4` · `portal/src/portal/newui/home/HomeList.tsx:22:428a29fa` · `portal/src/portal/pages/PortalTrainingV2.tsx:80:6f4cbc5b` (+21: `python3 kg/kg.py who-reads trainingApi.ts`)

## Tests (all, generated)
- `TrainingCertificates.tsx` ← `portal/src/portal/newui/training/TrainingCertificates.test.tsx`?
- `TrainingCourse.tsx` ← `portal/src/portal/teacher/training/inner.test.ts`
- `TrainingGrades.tsx` ← `portal/src/portal/newui/training/TrainingGrades.test.tsx`?
- `TrainingHome.tsx` ← `portal/src/portal/newui/training/TrainingHome.test.tsx`?
- `TrainingLevel.tsx` ← `portal/src/portal/newui/training/TrainingLevel.test.tsx`?
- `TrainingLevelExam.tsx` ← `portal/src/portal/newui/training/TrainingLevelExam.test.tsx`?
- `TrainingLevels.tsx` ← `portal/src/portal/newui/training/TrainingLevels.test.tsx`?
- `TrainingModuleExam.tsx` ← `portal/src/portal/newui/training/TrainingModuleExam.test.tsx`?
- `TrainingPart.tsx` ← `portal/src/portal/newui/training/TrainingPart.test.tsx`?
- `TrainingQuiz.tsx` ← `portal/src/portal/newui/training/TrainingQuiz.test.tsx`?
- `certificateFile.ts` ← `portal/src/portal/newui/training/certificateFile.test.ts`
- `continue.ts` ← `portal/src/portal/newui/training/continue.test.ts`
- `trainingApi.ts` ← `portal/src/portal/newui/training/TrainingLevelExam.test.tsx` · `portal/src/portal/newui/training/continue.test.ts` · `portal/src/portal/newui/training/courseName.test.ts` · `portal/src/portal/newui/training/legacyProviderName.test.ts` · `portal/src/portal/newui/training/providerNames.test.ts` · `portal/src/portal/teacher/training/inner.test.ts` (+2: `python3 kg/kg.py who-reads portal/src/portal/newui/training/trainingApi.ts`)

## Related (all, generated)
- (none)
