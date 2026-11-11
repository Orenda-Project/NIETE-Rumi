# classes — Teacher My Classes: list, class detail with roster, Add a class
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/classes kg=c083318c5efd gen=24b251747431 overflow=17 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `MyClassesPage.tsx` — list at /portal/teacher/classes; `ClassDetailPage.tsx` — roster; `AddClassPage.tsx`
- `model.ts` — rows from GET /classes and /me/grade-subjects; `routes.tsx` registers the pages
- `ClassesPages.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/classes`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `ClassesPages.test.tsx` | Pins My Classes, Class detail and Add a class over GET/POST /classes and student routes (bd-fmf24g.8) |
| `paths.ts` | Path builders for My Classes pages under /portal/teacher/classes: home, add, class detail |
| `parts.tsx` | Small pieces shared by Classes and Analytics: section heading with count, load and failed states, empty card |
| `checks.test.tsx` | Style and copy guard for My Classes pages: logical start/end, motion-safe, copy.ts words, 56px targets |
| … | 9 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `parts.tsx` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:9:145f5b04` · `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:27:0d0ee9fc` (+6)
- `paths.ts` ← imported by `portal/src/portal/teacher/classes/AddClassPage.tsx:14:b9774c64` · `portal/src/portal/teacher/classes/AddStudentsPage.tsx:15:42a3a6ab` (+4)
- `copy.ts` ← imported by `portal/src/portal/teacher/classes/AddClassPage.tsx:10:30cd0498` · `portal/src/portal/teacher/classes/AddStudentsPage.tsx:11:30cd0498` (+3)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- Nothing invents a number or a label; labels come from the API in the teacher's language (model.ts:9)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/classes/ClassesPages.test.tsx` (AddClassPage.tsx, ClassDetailPage.tsx, MyClassesPage.tsx, copy.ts, paths.ts, routes.tsx)
- `portal/src/portal/teacher/classes/checks.test.tsx` (copy.ts, paths.ts, routes.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
