# components — Shared old-UI portal components: layout, nav, training exams, attendance, lesson plans
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components kg=4439f97fb30a gen=a2f5dcfb43a1 overflow=177 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `PortalLayout.tsx` — shell every page renders in; picks nav, notices and recording room
- `PortalNavigation.tsx` — role/flag-aware menu; its *.test.tsx files pin each variant
- Tests (*.test.tsx here): `cd portal && npx vitest run src/portal/components` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__testing__/` | Test helper for driving the one-question module quiz → `__testing__/CLAUDE.md` |
| `assess/` | Learning-assessment (child test) page parts: engine frame, preflight, offline prep → `assess/CLAUDE.md` |
| `assessment-edit/` | Editing a made exam paper: question forms, local draft, version list → `assessment-edit/CLAUDE.md` |
| … | 100 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `PortalLayout.tsx` ← imported by `portal/src/portal/coach/insights/components/Frame.tsx:2:ff188793` · `portal/src/portal/coach/ui.tsx:4:ac211a43` (+46)
- `Skeleton.tsx` ← imported by `portal/src/App.tsx:30:2648ae31` · `portal/src/portal/auth/AnalyticsLogin.tsx:8:e21a4d15` (+28)
- `LoadingState.tsx` ← imported by `portal/src/portal/pages/LeaderHome.tsx:8:5cc42ac4` · `portal/src/portal/pages/LeaderObservation.tsx:5:63cbbcf9` (+24)
- … 38 more → `CLAUDE.index.md`

## Never (human)
- Do not change flag-off navigation: it must match the recorded snapshots (components/PortalNavigation.flagOff.test.tsx:8)
- Overlays must carry role=dialog data-state=open or Android Back cannot close them (components/coaching/BottomSheet.tsx:28)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/PortalLayout.newUi.test.tsx` (PortalLayout.tsx, RecordingBar.tsx)
- `portal/src/portal/components/ScoreIndicator.bands.test.tsx` (ScoreBreakdown.tsx, ScoreIndicator.tsx)
- … 62 more → `CLAUDE.index.md`

## Related (generated)
- docs: `docs/app-funnel-telemetry.md`? · `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/components/__testing__/CLAUDE.md`?
