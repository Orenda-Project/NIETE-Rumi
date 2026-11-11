# assessment — Teacher Assessment: New paper steps, My papers, paper page, editor, FDE board pattern
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/assessment kg=f0bfee815ffc gen=60bf304a72e2 overflow=98 rendered=2026-10-29 kg.py=1.1.0 -->

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
| … | 54 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/teacher/notices/NoticeHost.tsx:6:ecf5e3dc` · `portal/src/portal/teacher/notices/useNoticeWords.ts:2:ecf5e3dc` (+16)
- `model.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentHub.tsx:19:fad69eae` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:14:82ea77ad` (+13)
- … 25 more → `CLAUDE.index.md`

## Never (human)
- Caps and type lists belong to the bot: read from /assessment/options, never hardcoded (model.ts:19, api.ts:8)
- The FDE door and chips follow patternGrades from options, not a fixed Grade 5 (fde.early.test.tsx, bd-5jmnfj.4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` (AssessmentHub.tsx, EditPages.tsx, NewPaperSteps.tsx, PaperPage.tsx, RequestPage.tsx, api.ts, copy.ts, failure.ts, model.ts, paperCache.ts, paths.ts, store.ts)
- `portal/src/portal/teacher/assessment/fde.r6.test.tsx` (EditPages.tsx, NewPaperSteps.tsx, PaperPage.tsx, RequestPage.tsx, VersionsPage.tsx, api.ts, copy.ts, model.ts, paperCache.ts, paths.ts, store.ts)
- … 29 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/notices/CLAUDE.md`?
