# training — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/training -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CertificatesPage.tsx` | Training certificates: provider filter, a row each with logo, name, date, and a view/download tray (bd-fmf24g.12) |
| `CoursePage.tsx` | A course: Part tiles with done, length, best score and Next, module exam and required reading; Continue opens next part |
| `GradesPage.tsx` | My grades: teaching bands as tick rows with the 48-hour lock chip and Save, via useTrainingGrades |
| `LevelExamPage.tsx` | Level exam: gate, one question per screen (picks or written answer), and result via useLevelExam |
| `ModuleExamPage.tsx` | I-SAPS module exam: gate, per-answer autosave, sittings list with status cards, via useModuleExam |
| `PartPage.tsx` | One course part: chips, video and audio, handout and quick check rows, text, Mark done or Start quick check, Up next |
| `QuickCheckPage.tsx` | Quick check: one question per screen with Check, Next, Submit, then score ring result with Try again, via useQuickCheck |
| `TrainingFrame.tsx` | Shared v2 Training page frame (TeacherPage with Training tile) plus LoadState, EmptyNote, ProviderMark and ProviderTile |
| `TrainingHub.tsx` | Training main page: teaching-level chips with Edit to profile, Continue, provider tiles, certificates entry |
| `TrainingLevelPage.tsx` | A level: provider ladder as a journey path, level exam, courses, plus written-quiz result and level certificate |
| `TrainingProviderPage.tsx` | A provider: redirects to the open level on a ladder or single level; lists subjects as rows for open-order providers |
| `checks.test.tsx` | Style and copy guard for Training pages: logical start/end, motion-safe, copy.ts words, 56px targets (bd-fmf24g.5) |
| `copy.ts` | English and Urdu words for Training screens plus TRAINING_INNER, the reused new-UI training words, as COPY_ENTRIES |
| `inner.test.ts` | Tests partRows and answerStates: part numbering, done/next/locked, minutes and best score kept (bd-fmf24g.12) |
| `inner.ts` | Shapes course part rows and answer states for the v2 Training inner screens from the new UI hooks' data |
| `model.test.ts` | Tests Training model mappers: v2 base path, teachingLevels, course tiles from the /training/* reads (bd-fmf24g.5) |
| `model.ts` | Pure Training model: TRAINING_V2_BASE, provider logos, teaching levels, course tiles and certificate shaping |
| `parts.readonly.test.tsx` | Pins ChoiceList read-only rows and QuestionPrompt shared by teacher Training and the coach library (bd-s42dye.6) |
| `parts.tsx` | Shared v2 Training pieces: V2Row, HeroCard, dock buttons, question dots, answer choices, written box, certificate card |
| `routes.tsx` | Registers lazy Training pages (hub, provider, level, course, part, quizzes, exams, certificates, grades) via TeacherGate |
| `training.ur.test.tsx` | Renders Training hub and failure states in Urdu, incl. reused new-UI words via TRAINING_INNER (bd-fmf24g.13) |

## Who reads this (all, generated)
- `CertificatesPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:6:049d1963`
- `CoursePage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:7:138a9f71`
- `GradesPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:8:8bd8714c`
- `LevelExamPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:9:e66cd6ae`
- `ModuleExamPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:10:db7ac6da`
- `PartPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:11:cedea4ea`
- `QuickCheckPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:12:32c256e9`
- `TrainingFrame.tsx` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:18:18ea215e` · `portal/src/portal/teacher/training/CertificatesPage.tsx:13:5909f538` · `portal/src/portal/teacher/training/CoursePage.tsx:10:8dd0ed02` · `portal/src/portal/teacher/training/GradesPage.tsx:9:8dd0ed02` (+7: `python3 kg/kg.py who-reads TrainingFrame.tsx`)
- `TrainingHub.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:13:ae0b2b06`
- `TrainingLevelPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:14:5d9416af`
- `TrainingProviderPage.tsx` ← imported by `portal/src/portal/teacher/training/routes.tsx:15:1bc83ceb`
- `copy.ts` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:15:9880e121` · `portal/src/portal/teacher/training/CertificatesPage.tsx:4:3bfefe66` · `portal/src/portal/teacher/training/CoursePage.tsx:4:0bd7e9f6` · `portal/src/portal/teacher/training/GradesPage.tsx:4:3bfefe66` (+9: `python3 kg/kg.py who-reads copy.ts`)
- `inner.ts` ← imported by `portal/src/portal/teacher/training/CoursePage.tsx:8:ad987d7c` · `portal/src/portal/teacher/training/LevelExamPage.tsx:8:e5985fc6` · `portal/src/portal/teacher/training/ModuleExamPage.tsx:7:e5985fc6` · `portal/src/portal/teacher/training/QuickCheckPage.tsx:8:e5985fc6` (+1: `python3 kg/kg.py who-reads inner.ts`)
- `model.ts` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:16:d8d87e75` · `portal/src/portal/teacher/training/CertificatesPage.tsx:11:745df572` · `portal/src/portal/teacher/training/TrainingHub.tsx:15:74d4b72c` · `portal/src/portal/teacher/training/TrainingLevelPage.tsx:14:96669da4` (+2: `python3 kg/kg.py who-reads model.ts`)
- `parts.tsx` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:17:40b552fe` · `portal/src/portal/teacher/training/CertificatesPage.tsx:12:a11b130a` · `portal/src/portal/teacher/training/CoursePage.tsx:9:3f51918a` · `portal/src/portal/teacher/training/GradesPage.tsx:8:d9f116e0` (+4: `python3 kg/kg.py who-reads parts.tsx`)

## Tests (all, generated)
- `TrainingFrame.tsx` ← `portal/src/portal/components/loadingStates.test.tsx` · `portal/src/portal/teacher/TeacherPage.test.tsx` · `portal/src/portal/teacher/training/checks.test.tsx` · `portal/src/portal/teacher/training/parts.readonly.test.tsx` · `portal/src/portal/teacher/training/training.ur.test.tsx`
- `TrainingHub.tsx` ← `portal/src/portal/teacher/training/training.ur.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/training/checks.test.tsx` · `portal/src/portal/teacher/training/training.ur.test.tsx`
- `inner.ts` ← `portal/src/portal/teacher/training/inner.test.ts`
- `model.ts` ← `portal/src/portal/newui/training/providerNames.test.ts` · `portal/src/portal/teacher/training/checks.test.tsx` · `portal/src/portal/teacher/training/model.test.ts`
- `parts.tsx` ← `portal/src/portal/teacher/training/checks.test.tsx` · `portal/src/portal/teacher/training/parts.readonly.test.tsx` · `portal/src/portal/teacher/training/training.ur.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/training/checks.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`?
