# pages — Top-level route pages: teacher portal, leader/coach, assessment and school analytics
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/pages kg=c802a53ad3c4 gen=17cfc81297f6 overflow=211 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `PortalRoot.tsx` — what / renders; `PortalLogin.tsx` is the sign-in; routes are mounted in src/App.tsx
- `LeaderAssess.tsx` — coach Learning assessment, the largest page; its dashboard/results/review pages sit beside it
- Tests sit beside sources (*.test.ts(x)), vitest jsdom: `cd portal && npx vitest run src/portal/pages (the PortalX.flagOff tests pin flag-off pages to what they were)`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `PortalCoaching*` | 6 files; most used `PortalCoaching.flagOff.test.tsx`: bd-5rz1v.26: pins every coaching page unchanged when portal_new_ui is off, or /config fails |
| … | 64 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `PortalLogin.tsx` ← imported by `portal/src/App.tsx:10:66a7a677` · `portal/src/portal/pages/PortalRoot.tsx:5:1b16e767`
- `ClassicAssessment.tsx` ← imported by `portal/src/portal/pages/PortalAssessment.tsx:7:bd26bb61`
- `LeaderAssess.tsx` ← imported by `portal/src/App.tsx:92:23c84704`
- `LeaderAssessDashboard.tsx` ← imported by `portal/src/App.tsx:94:dbd5d54a`
- … 34 more → `CLAUDE.index.md`

## Never (human)
- PortalLessonPlans, PortalVideos(+Detail) and PortalReadingAssessments(+Detail) have no importer in src; /portal/lesson-plans redirects to curriculum (src/App.tsx:265-266)
- Flag-off pages must stay exactly as before (pages/PortalCoaching.flagOff.test.tsx, PortalDashboard.flagOff.test.tsx)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/pages/observation-bands.pages.test.tsx` (PortalCoaching.tsx, PortalCoachingAnalytics.tsx, PortalCoachingDetail.tsx, PortalDashboard.tsx, SchoolAnalytics.tsx, SchoolLessons.tsx)
- … 113 more → `CLAUDE.index.md`

## Related (generated)
- docs: `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `docs/reports/bug131-phase4-media-complete.md`? · `portal/src/CLAUDE.index.md`? · `portal/src/CLAUDE.md`? · `portal/src/components/ui/CLAUDE.index.md`? (+23)
