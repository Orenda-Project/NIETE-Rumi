# teacher — Teacher app v2 (portal_teacher_v2): frame, menu, route registry, Urdu/English layer
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher kg=3ff0069d7483 gen=0000ac61d04f overflow=105 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `routes.tsx` — registry: globs ./*/routes.tsx into TEACHER_ROUTES; App.tsx wraps each in TeacherGate
- `TeacherGate.tsx` — flag gate (portal_teacher_v2); `paths.ts` maps each feature to its v2/legacy path
- `routes.test.ts` — vitest (portal/vitest.config.ts, jsdom): `cd portal && npx vitest run src/portal/teacher`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 15 sub-dirs, each with `CLAUDE.md` | `analytics/` · `assessment/` · `attendance/` · `classes/` · `coaching/` · `home/` · `icons/` · `lessons/` · `notices/` · `observations/` · `pages/` · `remind/` · `share/` · `training/` · `ui/` |
| `i18n.ts` | Teacher v2 language layer (flat en/ur): bilingual() with a shape-typed Urdu, langOf, copyIn, untranslated() checker |
| … | 41 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `i18n.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:8:0f66c8aa` · `portal/src/portal/auth/AnalyticsLogin.tsx:9:b07c182e` (+241)
- `TeacherPage.tsx` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:2:e8f36f5c` · `portal/src/portal/coach/card/SchoolCardPage.tsx:4:e8f36f5c` (+48)
- `routes.tsx` ← imported by `portal/src/App.tsx:16:a9c609d6` · `portal/src/portal/pages/LeaderHome.tsx:12:e4d9854a` (+32)
- … 10 more → `CLAUDE.index.md`

## Never (human)
- Pages go in through lazyPage, never a static import: the registry sits in the first chunk (routes.tsx:26, bd-sex15q.34)
- Every feature copy.ts must export COPY_ENTRY or it silently skips Urdu checks (copyRegistry.guard.test.ts:5)
- useTeacherV2 is fail-closed: unreadable /config means v2 off (useTeacherV2.ts:9)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/TeacherNavigation.coach.test.tsx` (TeacherNavigation.tsx, TeacherPage.tsx, copy.ts, menu.ts)
- `portal/src/portal/teacher/frame.ur.test.tsx` (TeacherNavigation.tsx, TeacherPage.tsx, copy.ts, format.ts)
- … 76 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`? · `portal/src/portal/teacher/ui/README.md`?
