# lessons — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/lessons -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `ChaptersPage.tsx` | Step 2 of a new lesson plan: a subject's chapters as rows (number, title, pages, lesson count) linking to lessons |
| `LessonPages.test.tsx` | Pins Lesson Plans inner pages (chapters, lessons, Preparing, viewer) over the shared lesson-plan client (bd-fmf24g.3) |
| `LessonsAll.test.tsx` | Pins All lesson plans: range default, API asked for the shown dates and prior period, KPI numbers (bd-fmf24g.3) |
| `LessonsAll.tsx` | All lesson plans page (See all from Recent): DateRangeBar, class filter, KPI tiles, plans by Pakistan day |
| `LessonsHome.test.tsx` | Pins Lesson Plans main page and reopen-by-key page; picker starred classes and catalogue links (bd-fmf24g.3) |
| `LessonsHome.tsx` | Lesson Plans main page: + New lesson plan, Being made (grades 6-12), collapsible Recent with See all |
| `LessonsPage.tsx` | A chapter's lesson plans list: LP number, title, pages, Worksheet and Revision icons, Used tick; tap opens or Preparing |
| `LoadState.tsx` | Shared loading, failed (Try again) and empty states for the Lesson Plans list pages |
| `NewLessonPage.tsx` | Step 1 of 3 of a new lesson plan: Grade and subject via the kit ClassPicker, own classes with plans starred (bd-fgj73x) |
| `OpenPlanPage.tsx` | Reopens a plan by key (?plan=k5:... or g612:...) and replaces itself with the viewer or Preparing page |
| `PreparingPage.tsx` | Grades 6-12 plan being written: countdown ring, polling with back-off, opens the viewer in place; Try again on failure |
| `Steps.tsx` | Step bar for a new lesson plan (Grade and subject, Chapter, Lesson), same look as Assessment's New paper |
| `ThingToTryStrip.test.tsx` | Pins ThingToTryStrip: read for a lesson, no strip on failed read, taps logged with step (bd-v0toag.8) |
| `ThingToTryStrip.tsx` | Amber 'thing to try' strip above a grade 1-5 plan, from GET /teacher/thing-to-try for coaching test groups C and D |
| `ViewerPage.step.test.tsx` | Pins ViewerPage receiving the strip's step: highlight once read, each tap a new jump, none without a step (bd-v0toag.8) |
| `ViewerPage.tsx` | Open lesson plan viewer: the plan, Start DC observation card with prefill, answer key, WhatsApp send, quiz button |
| `audience.ts` | isLessonsLeader/useLessonsLeader: is the reader a leader (coach, principal, AEO...) on Lesson Plans pages (bd-4joiqz) |
| `checks.test.tsx` | Style and copy guard for Lesson Plans pages: logical start/end, motion-safe, copy.ts words, 56px targets (bd-fmf24g.3) |
| `copy.ts` | English and Urdu words for the Lesson Plans screens (LESSONS bilingual), registered as COPY_ENTRY |
| `days.ts` | Pakistan-day helpers for lesson lists: pkToday, pkDayOf, dayName (Today, Yesterday, Mon 5 Oct) |
| `frame.test.tsx` | Pins that every Lesson Plans page wears the TeacherPage frame, tile beside title except the viewer, long titles wrap |
| `leaders.app.test.tsx` | Pins via the real App that a coach opens teacher Lesson Plans through TeacherGate leaders, no redirect (bd-4joiqz) |
| `leaders.test.tsx` | Pins Lesson Plans for a leader: viewer hides DC, thing to try, WhatsApp send; teacher view unchanged (bd-4joiqz) |
| `lessonHistory.test.ts` | Tests lessonHistory.ts: historyParams from range and class filter, KPI tiles with change, grouping by Pakistan day |
| `lessonHistory.ts` | Client for GET /api/portal/lesson-plans/history plus shaping: query params, KPI tiles and day-grouped items |
| `lessons.ur.test.tsx` | Renders Lesson Plans main, chapters, lessons, Preparing, viewer and All in Urdu from LESSONS (bd-fmf24g.13) |
| `newFlow.test.tsx` | Pins Lesson Plans in the Assessment-style flow: + New lesson plan, Being made, Recent open with See all (bd-fgj73x) |
| `paths.ts` | Path builders for Lesson Plans pages with state in the query so Back and reload land correctly; dcHref for DC prefill |
| `recent.ts` | Shapes the teacher's recent lesson plans into HistoryList day groups, each row reopening its plan by key |
| `routes.tsx` | Registers lazy Lesson Plans pages under /portal/teacher/lessons via TeacherGate, some open to leaders |
| `useOpenLesson.ts` | Hook opening a lesson on the v2 pages: shared client decides ready or being written, then viewer or Preparing |

## Who reads this (all, generated)
- `ChaptersPage.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:6:4c2309bc`
- `LessonsAll.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:7:da48a382`
- `LessonsHome.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:8:08b40a36`
- `LessonsPage.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:9:b209f078`
- `LoadState.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:3:9f537cfa` · `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:5:9f537cfa` · `portal/src/portal/coach/pages/CoachObservation.tsx:10:9f537cfa` · `portal/src/portal/coach/pages/CoachReports.tsx:8:9f537cfa` (+10: `python3 kg/kg.py who-reads LoadState.tsx`)
- `NewLessonPage.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:10:f40ea9dd`
- `OpenPlanPage.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:11:156fa8c9`
- `PreparingPage.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:12:2102f6ec`
- `Steps.tsx` ← imported by `portal/src/portal/teacher/lessons/ChaptersPage.tsx:12:d48f4d82` · `portal/src/portal/teacher/lessons/LessonsPage.tsx:15:d48f4d82` · `portal/src/portal/teacher/lessons/NewLessonPage.tsx:12:d48f4d82`
- `ThingToTryStrip.tsx` ← imported by `portal/src/portal/teacher/lessons/ViewerPage.tsx:19:a37017c3`
- `ViewerPage.tsx` ← imported by `portal/src/portal/teacher/lessons/routes.tsx:13:f2987502`
- `audience.ts` ← imported by `portal/src/portal/teacher/lessons/LessonsHome.tsx:16:4b523f14` · `portal/src/portal/teacher/lessons/ViewerPage.tsx:21:4b523f14`
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:8:8fc97b6c` · `portal/src/portal/coach/pages/CoachReports.tsx:6:8fc97b6c` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:7:8fc97b6c` · `portal/src/portal/coach/reports/SendReport.tsx:10:8fc97b6c` (+25: `python3 kg/kg.py who-reads copy.ts`)
- `days.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:9:10ae0f6b` · `portal/src/portal/coach/pages/CoachReports.tsx:7:75e1c76a` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:8:dfeab019` · `portal/src/portal/coach/reports/SendReport.tsx:11:10ae0f6b` (+8: `python3 kg/kg.py who-reads days.ts`)
- `lessonHistory.ts` ← imported by `portal/src/portal/teacher/lessons/LessonsAll.tsx:14:21afae3d`
- `paths.ts` ← imported by `portal/src/portal/coach/training/appReady.ts:1:354ad124` · `portal/src/portal/components/PortalNavigation.tsx:19:58529f73` · `portal/src/portal/fln/FlnGate.tsx:20:62e12e9c` · `portal/src/portal/fln/PlanPage.tsx:34:62e12e9c` (+21: `python3 kg/kg.py who-reads paths.ts`)
- `recent.ts` ← imported by `portal/src/portal/teacher/lessons/LessonsHome.tsx:15:8d34a793`
- `useOpenLesson.ts` ← imported by `portal/src/portal/teacher/notices/useOpenNotice.ts:5:706efc51` · `portal/src/portal/teacher/lessons/LessonsPage.tsx:14:c7d6fb3a` · `portal/src/portal/teacher/lessons/PreparingPage.tsx:16:a239b2b6`

## Tests (all, generated)
- `ChaptersPage.tsx` ← `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/frame.test.tsx` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx`
- `LessonsAll.tsx` ← `portal/src/portal/teacher/lessons/LessonsAll.test.tsx` · `portal/src/portal/teacher/lessons/frame.test.tsx`
- `LessonsHome.tsx` ← `portal/src/portal/teacher/lessons/LessonsHome.test.tsx` · `portal/src/portal/teacher/lessons/frame.test.tsx` · `portal/src/portal/teacher/lessons/leaders.test.tsx` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx`
- `LessonsPage.tsx` ← `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/frame.test.tsx` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx`
- `LoadState.tsx` ← `portal/src/portal/components/loadingStates.test.tsx` · `portal/src/portal/teacher/lessons/checks.test.tsx`
- `NewLessonPage.tsx` ← `portal/src/portal/fln/tests/golden.flagOff.test.tsx` · `portal/src/portal/fln/tests/hiddenBand.page.test.tsx` · `portal/src/portal/teacher/lessons/LessonsHome.test.tsx` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx`
- `OpenPlanPage.tsx` ← `portal/src/portal/fln/tests/golden.flagOff.test.tsx` · `portal/src/portal/fln/tests/hooks.test.tsx` · `portal/src/portal/teacher/lessons/LessonsHome.test.tsx`
- `PreparingPage.tsx` ← `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/frame.test.tsx` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx` · `portal/src/portal/teacher/notices/wiring.test.tsx`
- `ThingToTryStrip.tsx` ← `portal/src/portal/teacher/lessons/ThingToTryStrip.test.tsx`
- `ViewerPage.tsx` ← `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/ViewerPage.step.test.tsx` · `portal/src/portal/teacher/lessons/checks.test.tsx` · `portal/src/portal/teacher/lessons/frame.test.tsx` · `portal/src/portal/teacher/lessons/leaders.test.tsx` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/coaching/libraryPick.test.tsx` · `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/LessonsAll.test.tsx` · `portal/src/portal/teacher/lessons/LessonsHome.test.tsx` · `portal/src/portal/teacher/lessons/ThingToTryStrip.test.tsx` (+8: `python3 kg/kg.py who-reads portal/src/portal/teacher/lessons/copy.ts`)
- `days.ts` ← `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `lessonHistory.ts` ← `portal/src/portal/fln/tests/readers.test.tsx` · `portal/src/portal/teacher/lessons/lessonHistory.test.ts` · `portal/src/portal/teacher/lessons/lessons.ur.test.tsx`
- `paths.ts` ← `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx` · `portal/src/portal/teacher/classes/ClassesPages.test.tsx` · `portal/src/portal/teacher/classes/model.test.ts` · `portal/src/portal/teacher/coaching/libraryPick.test.tsx` · `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/LessonsAll.test.tsx` (+8: `python3 kg/kg.py who-reads portal/src/portal/teacher/lessons/paths.ts`)
- `recent.ts` ← `portal/src/portal/fln/tests/readers.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/coaching/libraryPick.test.tsx` · `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/lessons/LessonsAll.test.tsx` · `portal/src/portal/teacher/lessons/LessonsHome.test.tsx` · `portal/src/portal/teacher/lessons/leaders.test.tsx` · `portal/src/portal/teacher/lessons/newFlow.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/share/CLAUDE.md`?
