# assessment-edit — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/components/assessment-edit -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AddQuestionFields.test.tsx` | Pins AddQuestionFields: per-kind inputs (short question, pairs), RTL, error display and onDone payload |
| `AddQuestionFields.tsx` | Form fields for adding a new question of a chosen kind (AddKind) to an assessment paper being edited |
| `AssessmentEditor.test.tsx` | Pins AssessmentEditor: loads questions, edit/remove/restore/add, draft save and publishing a new version (mocked api) |
| `AssessmentEditor.tsx` | Editor for one exam-paper version: edit, remove, restore, add questions, keep a local draft, save as a new version |
| `AssessmentVersionsDialog.test.tsx` | Pins AssessmentVersionsDialog listing versions with status, including a failed one with no version number |
| `AssessmentVersionsDialog.tsx` | Dialog listing every version of a paper (date, status, latest) with an Edit action per version |
| `QuestionFields.test.tsx` | Pins QuestionFields: option text and correct-option editing, shape-specific inputs emit onDone edit |
| `QuestionFields.tsx` | Form fields for editing one existing paper question by shape (options, standard, lines) with RTL support |
| `draft.test.ts` | Pins draft.ts: empty/dirty, remove/restore, set edit, add question, toChanges and localStorage save/load/clear |
| `draft.ts` | Pure model of unsaved paper changes as a list of changes (never a rebuilt paper), persisted in localStorage (bd-hb8qs) |

## Who reads this (all, generated)
- `AddQuestionFields.tsx` ← imported by `portal/src/portal/components/assessment-edit/AssessmentEditor.tsx:11:0e92a0a5`
- `AssessmentEditor.tsx` ← imported by `portal/src/portal/components/AssessmentPapersPanel.tsx:29:13d6e7c7`
- `AssessmentVersionsDialog.tsx` ← imported by `portal/src/portal/components/AssessmentPapersPanel.tsx:30:ad6b99df`
- `QuestionFields.tsx` ← imported by `portal/src/portal/components/assessment-edit/AssessmentEditor.tsx:10:aeac43ae`
- `draft.ts` ← imported by `portal/src/portal/teacher/assessment/EditPages.tsx:10:8ba0e596` · `portal/src/portal/components/assessment-edit/AssessmentEditor.tsx:16:082ec0da`

## Tests (all, generated)
- `AddQuestionFields.tsx` ← `portal/src/portal/components/assessment-edit/AddQuestionFields.test.tsx`
- `AssessmentEditor.tsx` ← `portal/src/portal/components/assessment-edit/AssessmentEditor.test.tsx`
- `AssessmentVersionsDialog.tsx` ← `portal/src/portal/components/assessment-edit/AssessmentVersionsDialog.test.tsx`
- `QuestionFields.tsx` ← `portal/src/portal/components/assessment-edit/QuestionFields.test.tsx`
- `draft.ts` ← `portal/src/portal/components/assessment-edit/draft.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/components/CLAUDE.md`?
