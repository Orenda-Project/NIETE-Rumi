# lessons — Teacher Lesson Plans: new plan steps, chapters, lists, viewer, All lesson plans
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/lessons kg=5c0fb1624b94 gen=44dcaf3c9958 overflow=68 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `routes.tsx` — pages under /portal/teacher/lessons; `paths.ts` — URLs carrying state in the query
- `LessonsHome.tsx`, `ViewerPage.tsx` — main page and open plan; `useOpenLesson.ts` — open decision
- `LessonPages.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/lessons`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words for the Lesson Plans screens (LESSONS bilingual), registered as COPY_ENTRY |
| `paths.ts` | Path builders for Lesson Plans pages with state in the query so Back and reload land correctly; dcHref for DC prefill |
| … | 31 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:8:8fc97b6c` · `portal/src/portal/coach/pages/CoachReports.tsx:6:8fc97b6c` (+27)
- `paths.ts` ← imported by `portal/src/portal/coach/training/appReady.ts:1:354ad124` · `portal/src/portal/components/PortalNavigation.tsx:19:58529f73` (+23)
- … 16 more → `CLAUDE.index.md`

## Never (human)
- Leaders (coach, principal, AEO...) read these pages through route `leaders: true`; teacher-only parts stay hidden (routes.tsx:25, bd-4joiqz)
- Every inner page keeps its state in the URL so Back and reload land correctly (paths.ts header)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/lessons/lessons.ur.test.tsx` (ChaptersPage.tsx, LessonsHome.tsx, LessonsPage.tsx, NewLessonPage.tsx, PreparingPage.tsx, ViewerPage.tsx, copy.ts, lessonHistory.ts, paths.ts)
- `portal/src/portal/teacher/lessons/frame.test.tsx` (ChaptersPage.tsx, LessonsAll.tsx, LessonsHome.tsx, LessonsPage.tsx, PreparingPage.tsx, ViewerPage.tsx, copy.ts, paths.ts)
- … 21 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/CLAUDE.index.md`? · `portal/src/CLAUDE.md`? · `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/fln/CLAUDE.index.md`? · `portal/src/portal/fln/tests/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? (+14)
