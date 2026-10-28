# lessons — New-UI Lesson Plans, grades 1-12, behind one client over two services
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/lessons kg=0e3f4acd10d4 gen=2e932a829216 overflow=23 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `NewLessonPlans.tsx` — main page and flow router; `RecentPlans.tsx` shows the last 10
- `lessonPlansApi.ts` — only place that knows grades 1-5 vs 6-12 services; tests: `cd portal && npx vitest run src/portal/newui/lessons` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `shared.ts` | Lesson Plans screens' shared path constant, View types and helpers |
| `lessonPlansApi*` | 3 files; most used `lessonPlansApi.ts`: bd-5rz1v.14: single client for lesson plans grades 1-12, hiding the /curriculum catalogue vs 6-12 services |
| `NewLessonPlans.test.tsx` | bd-5rz1v.14/bd-k23p38: new Lesson Plans flow for grades 1-12, main page and Recent last 10 |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `shared.ts` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:4:e5dbc0df` · `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:6:e5dbc0df` (+30)
- `lessonPlansApi.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:20:0f0b92bd` · `portal/src/portal/teacher/coaching/libraryPick.ts:2:d4185e0b` (+10)
- `LoadStatus.tsx` ← imported by `portal/src/portal/newui/lessons/LessonPlanPages.tsx:22:45665a4c` · `portal/src/portal/newui/lessons/NewLessonPlans.tsx:17:45665a4c`
- … 3 more → `CLAUDE.index.md`

## Never (human)
- Only lessonPlansApi.ts may know the two lesson-plan services (lessonPlansApi.ts:7, bd-5rz1v.14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/newui/lessons/NewLessonPlans.test.tsx` (NewLessonPlans.tsx, lessonPlansApi.ts)
- `portal/src/portal/fln/tests/fln-ab-isolation.client.test.ts` (lessonPlansApi.ts)
- … 16 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/fln/tests/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/DESIGN.md`? · `portal/src/portal/newui/lessons/CLAUDE.index.md`? (+3)
