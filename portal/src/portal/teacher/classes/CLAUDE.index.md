# classes — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/classes -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AddClassPage.tsx` | Add a class form (options from GET /classes) posting POST /classes; routed at /portal/teacher/classes/add |
| `ClassDetailPage.tsx` | One class: title and chips, shortcuts to Attendance and its lesson plans, roster add by paste and remove |
| `ClassesPages.test.tsx` | Pins My Classes, Class detail and Add a class over GET/POST /classes and student routes (bd-fmf24g.8) |
| `MyClassesPage.tsx` | My Classes list as Grade-Subject rows linking to each class, with Add a class when the server's canAdd allows |
| `checks.test.tsx` | Style and copy guard for My Classes pages: logical start/end, motion-safe, copy.ts words, 56px targets |
| `classes.ur.test.tsx` | Renders My Classes list, detail and Add a class in Urdu; class and child names stay as the API sends (bd-fmf24g.13) |
| `copy.ts` | English and Urdu words for My Classes pages, registered as COPY_ENTRY for the Urdu completeness checks |
| `model.test.ts` | Tests classes model.ts: gradeNumber, class rows with other subjects and Class teacher, roster rows (bd-fmf24g.8) |
| `model.ts` | Pure My Classes model: class rows, chips, lesson-plan link and roster rows from /classes and /me/grade-subjects |
| `parts.tsx` | Small pieces shared by Classes and Analytics: section heading with count, load and failed states, empty card |
| `paths.ts` | Path builders for My Classes pages under /portal/teacher/classes: home, add, class detail |
| `routes.tsx` | Registers lazy My Classes, Add a class and Class detail pages under /portal/teacher/classes via TeacherGate |

## Who reads this (all, generated)
- `AddClassPage.tsx` ← imported by `portal/src/portal/teacher/classes/routes.tsx:6:939021a5`
- `ClassDetailPage.tsx` ← imported by `portal/src/portal/teacher/classes/routes.tsx:7:8c893550`
- `MyClassesPage.tsx` ← imported by `portal/src/portal/teacher/classes/routes.tsx:8:f944314b`
- `copy.ts` ← imported by `portal/src/portal/teacher/classes/AddClassPage.tsx:10:30cd0498` · `portal/src/portal/teacher/classes/ClassDetailPage.tsx:14:30cd0498` · `portal/src/portal/teacher/classes/MyClassesPage.tsx:10:30cd0498` · `portal/src/portal/teacher/classes/parts.tsx:4:30cd0498`
- `model.ts` ← imported by `portal/src/portal/teacher/classes/AddClassPage.tsx:12:65ebd02a` · `portal/src/portal/teacher/classes/ClassDetailPage.tsx:16:c3f6536d` · `portal/src/portal/teacher/classes/MyClassesPage.tsx:12:d40e5606`
- `parts.tsx` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:9:145f5b04` · `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:22:0d0ee9fc` · `portal/src/portal/teacher/analytics/SchoolView.tsx:12:3071c9ab` · `portal/src/portal/teacher/analytics/sections.tsx:5:da5eb7f1` (+3: `python3 kg/kg.py who-reads parts.tsx`)
- `paths.ts` ← imported by `portal/src/portal/teacher/classes/AddClassPage.tsx:14:588df4b0` · `portal/src/portal/teacher/classes/ClassDetailPage.tsx:18:588df4b0` · `portal/src/portal/teacher/classes/MyClassesPage.tsx:14:86a30bba` · `portal/src/portal/teacher/classes/model.ts:4:42a3a6ab` (+1: `python3 kg/kg.py who-reads paths.ts`)

## Tests (all, generated)
- `AddClassPage.tsx` ← `portal/src/portal/teacher/classes/ClassesPages.test.tsx`
- `ClassDetailPage.tsx` ← `portal/src/portal/teacher/classes/ClassesPages.test.tsx`
- `MyClassesPage.tsx` ← `portal/src/portal/teacher/classes/ClassesPages.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/classes/ClassesPages.test.tsx` · `portal/src/portal/teacher/classes/checks.test.tsx` · `portal/src/portal/teacher/classes/classes.ur.test.tsx`
- `model.ts` ← `portal/src/portal/teacher/classes/model.test.ts`
- `parts.tsx` ← `portal/src/portal/components/loadingStates.test.tsx`
- `paths.ts` ← `portal/src/portal/teacher/classes/ClassesPages.test.tsx` · `portal/src/portal/teacher/classes/checks.test.tsx` · `portal/src/portal/teacher/classes/classes.ur.test.tsx` · `portal/src/portal/teacher/classes/model.test.ts`
- `routes.tsx` ← `portal/src/portal/teacher/classes/ClassesPages.test.tsx` · `portal/src/portal/teacher/classes/checks.test.tsx` · `portal/src/portal/teacher/classes/classes.ur.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
