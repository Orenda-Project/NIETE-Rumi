# assessment-edit — Editing a made exam paper: question forms, local draft, version list
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/assessment-edit kg=1fb4c71ed29e gen=15dabd41311f overflow=13 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `AssessmentEditor.tsx` — edit, remove, restore, add questions and save as a new version
- `draft.ts` — pure change-list model kept in localStorage; tests: `cd portal && npx vitest run src/portal/components/assessment-edit` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `draft.ts` | Pure model of unsaved paper changes as a list of changes (never a rebuilt paper), persisted in localStorage (bd-hb8qs) |
| `AddQuestionFields.test.tsx` | Pins AddQuestionFields: per-kind inputs (short question, pairs), RTL, error display and onDone payload |
| `AddQuestionFields.tsx` | Form fields for adding a new question of a chosen kind (AddKind) to an assessment paper being edited |
| … | 9 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `draft.ts` ← imported by `portal/src/portal/teacher/assessment/EditPages.tsx:10:8ba0e596` · `portal/src/portal/components/assessment-edit/AssessmentEditor.tsx:16:082ec0da`
- `AddQuestionFields.tsx` ← imported by `portal/src/portal/components/assessment-edit/AssessmentEditor.tsx:11:0e92a0a5`
- `AssessmentEditor.tsx` ← imported by `portal/src/portal/components/AssessmentPapersPanel.tsx:29:13d6e7c7`
- `AssessmentVersionsDialog.tsx` ← imported by `portal/src/portal/components/AssessmentPapersPanel.tsx:30:ad6b99df`
- … 1 more → `CLAUDE.index.md`

## Never (human)
- A draft is a list of changes, never a rebuilt paper; the bot applies its own rules (draft.ts:4, bd-hb8qs)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/assessment-edit/AddQuestionFields.test.tsx` (AddQuestionFields.tsx)
- `portal/src/portal/components/assessment-edit/AssessmentEditor.test.tsx` (AssessmentEditor.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.md`? · `portal/src/portal/components/assessment-edit/CLAUDE.index.md`? · `portal/src/portal/components/assessment-edit/CLAUDE.md`?
