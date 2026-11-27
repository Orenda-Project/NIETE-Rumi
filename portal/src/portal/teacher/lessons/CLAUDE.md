# lessons — Teacher Lesson Plans: new plan steps, chapters, lists, viewer, All lesson plans
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/lessons kg=c464ee144f90 gen=f62d95f710b8 overflow=109 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `routes.tsx` — pages under /portal/teacher/lessons; `paths.ts` — URLs carrying state in the query
- `LessonsHome.tsx`, `ViewerPage.tsx` — main page and open plan; `useOpenLesson.ts` — open decision
- `LessonPages.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/lessons`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `own/` | (no description yet) → `own/CLAUDE.md` |
| `shelf/` | (no description yet) → `shelf/CLAUDE.md` |
| `paths.ts` | Path builders for Lesson Plans pages with state in the query so Back and reload land correctly; dcHref for DC prefill |
| `copy.ts` | English and Urdu words for the Lesson Plans screens (LESSONS bilingual), registered as COPY_ENTRY |
| … | 50 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `paths.ts` ← imported by `portal/src/portal/coach/training/appReady.ts:1:354ad124` · `portal/src/portal/components/PortalNavigation.tsx:21:58529f73` (+38)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:8:8fc97b6c` · `portal/src/portal/coach/pages/CoachObservation.tsx:9:8fc97b6c` (+37)
- … 23 more → `CLAUDE.index.md`

## Never (human)
- Leaders (coach, principal, AEO...) read these pages through route `leaders: true`; teacher-only parts stay hidden (routes.tsx:25, bd-4joiqz)
- Every inner page keeps its state in the URL so Back and reload land correctly (paths.ts header)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/lessons/lessons.ur.test.tsx` (ChaptersPage.tsx, LessonsHome.tsx, LessonsPage.tsx, NewLessonPage.tsx, PreparingPage.tsx, ViewerPage.tsx, copy.ts, lessonHistory.ts, paths.ts)
- `portal/src/portal/teacher/lessons/frame.test.tsx` (ChaptersPage.tsx, LessonsAll.tsx, LessonsHome.tsx, LessonsPage.tsx, PreparingPage.tsx, ViewerPage.tsx, copy.ts, paths.ts)
- … 47 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/share/CLAUDE.md`?
