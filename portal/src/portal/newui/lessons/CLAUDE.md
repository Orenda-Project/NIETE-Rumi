# lessons — New-UI Lesson Plans, grades 1-12, behind one client over two services
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/lessons kg=f397ad1416f8 gen=b32a85bbaf69 overflow=27 rendered=2026-11-11 kg.py=1.1.0 -->

## Entry points
- `NewLessonPlans.tsx` — main page and flow router; `RecentPlans.tsx` shows the last 10
- `lessonPlansApi.ts` — only place that knows grades 1-5 vs 6-12 services; tests: `cd portal && npx vitest run src/portal/newui/lessons` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `lessonPlansApi*` | 3 files; most used `lessonPlansApi.ts`: bd-5rz1v.14: single client for lesson plans grades 1-12, hiding the /curriculum catalogue vs 6-12 services |
| `shared.ts` | Lesson Plans screens' shared path constant, View types and helpers |
| `NewLessonPlans.test.tsx` | bd-5rz1v.14/bd-k23p38: new Lesson Plans flow for grades 1-12, main page and Recent last 10 |
| `gbOnRequest.test.tsx` | (unmapped) |
| `LoadStatus.tsx` | Loading spinner Hero, "Not loaded" with Try again, or "Nothing yet" for a lesson-plans load state |
| … | 5 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `shared.ts` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:4:e5dbc0df` · `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:6:e5dbc0df` (+36)
- `lessonPlansApi.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:20:0f0b92bd` · `portal/src/portal/teacher/coaching/libraryPick.ts:2:d4185e0b` (+15)
- `LoadStatus.tsx` ← imported by `portal/src/portal/newui/lessons/LessonPlanPages.tsx:22:45665a4c` · `portal/src/portal/newui/lessons/NewLessonPlans.tsx:17:45665a4c`
- `LessonPlanPages.tsx` ← imported by `portal/src/portal/newui/lessons/NewLessonPlans.tsx:18:3378c26b`
- … 2 more → `CLAUDE.index.md`

## Never (human)
- Only lessonPlansApi.ts may know the two lesson-plan services (lessonPlansApi.ts:7, bd-5rz1v.14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/newui/lessons/NewLessonPlans.test.tsx` (NewLessonPlans.tsx, lessonPlansApi.ts)
- `portal/src/portal/fln/tests/fln-ab-isolation.client.test.ts` (lessonPlansApi.ts)
- … 22 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/DESIGN.md`?
