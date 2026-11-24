# assessment — Teacher Assessment: New paper steps, My papers, paper page, editor, FDE board pattern
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/assessment kg=6b7ce2f2f0a7 gen=eb2e5e07d87e overflow=132 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `routes.tsx` — all pages under /portal/teacher/assessment; `model.ts` — New paper rules and steps
- `api.ts` — reads over portal.* (catalogue, papers, jobs); `NewPaperSteps.tsx` — the step screens
- `checks.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/assessment`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 files) |
| `__snapshots__/` | → (not mapped: excluded; 2 files) |
| `copy.ts` | English and Urdu words for every Assessment screen (machine-drafted Urdu), registered as COPY_ENTRY |
| `paths.ts` | Path builders for every Assessment page under /portal/teacher/assessment: new paper, request, paper, versions, edit |
| … | 71 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/teacher/notices/NoticeHost.tsx:6:ecf5e3dc` · `portal/src/portal/teacher/notices/useNoticeWords.ts:2:ecf5e3dc` (+19)
- `model.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentHub.tsx:19:fad69eae` · `portal/src/portal/teacher/assessment/BookPicker.tsx:11:1ce67278` (+15)
- … 30 more → `CLAUDE.index.md`

## Never (human)
- Caps and type lists belong to the bot: read from /assessment/options, never hardcoded (model.ts:19, api.ts:8)
- The FDE door and chips follow patternGrades from options, not a fixed Grade 5 (fde.early.test.tsx, bd-5jmnfj.4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` (AssessmentHub.tsx, EditPages.tsx, NewPaperSteps.tsx, PaperPage.tsx, RequestPage.tsx, api.ts, copy.ts, failure.ts, model.ts, paperCache.ts, paths.ts, store.ts)
- … 44 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/components/assessment-jobs/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/notices/CLAUDE.md`?
