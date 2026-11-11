# teacher — Teacher app v2 (portal_teacher_v2): frame, menu, route registry, Urdu/English layer
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher kg=ea814ad751d5 gen=5a20cd18a8d7 overflow=123 rendered=2026-11-11 kg.py=1.1.0 -->

## Entry points
- `routes.tsx` — registry: globs ./*/routes.tsx into TEACHER_ROUTES; App.tsx wraps each in TeacherGate
- `TeacherGate.tsx` — flag gate (portal_teacher_v2); `paths.ts` maps each feature to its v2/legacy path
- `routes.test.ts` — vitest (portal/vitest.config.ts, jsdom): `cd portal && npx vitest run src/portal/teacher`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 18 sub-dirs, each with `CLAUDE.md` | `analytics/` · `assessment/` · `attendance/` · `classes/` · `coaching/` · `home/` · `icons/` · `lessons/` · `notices/` · `observations/` · `pages/` · `principal/` · `remind/` · `roleSwitch/` · `share/` · `topicpaper/` · `training/` · `ui/` |
| … | 46 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `i18n.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:8:0f66c8aa` · `portal/src/portal/auth/AnalyticsLogin.tsx:9:b07c182e` (+283)
- `TeacherPage.tsx` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:4:fab0408f` · `portal/src/portal/coach/card/SessionReportPage.tsx:3:e8f36f5c` (+59)
- `routes.tsx` ← imported by `portal/src/App.tsx:16:a9c609d6` · `portal/src/portal/pages/LeaderHome.tsx:12:e4d9854a` (+37)
- … 10 more → `CLAUDE.index.md`

## Never (human)
- Pages go in through lazyPage, never a static import: the registry sits in the first chunk (routes.tsx:26, bd-sex15q.34)
- Every feature copy.ts must export COPY_ENTRY or it silently skips Urdu checks (copyRegistry.guard.test.ts:5)
- useTeacherV2 is fail-closed: unreadable /config means v2 off (useTeacherV2.ts:9)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/TeacherNavigation.coach.test.tsx` (TeacherNavigation.tsx, TeacherPage.tsx, copy.ts, menu.ts)
- `portal/src/portal/teacher/frame.ur.test.tsx` (TeacherNavigation.tsx, TeacherPage.tsx, copy.ts, format.ts)
- … 93 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`? · `portal/src/portal/teacher/ui/README.md`?
