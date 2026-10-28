# hooks — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/hooks -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AuthProvider.boot.test.tsx` | Pins that the signed-in user is requested at first frame for coach and RM paths (bd-sex15q.34) |
| `AuthProvider.test.tsx` | Pins that the signed-in user is read once per visit, with 30 s background re-read (bd-fxk3t8) |
| `AuthProvider.tsx` | Root provider holding the signed-in user once per visit above all routes (bd-fxk3t8) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `authContext.ts` | Context object for the user PortalLayout loaded, in its own module so mocks keep it real |
| `firstPage.test.tsx` | Pins first-page loading: /me instead of /dashboard, parallel /config, 30 s reuse (bd-fxk3t8) |
| `useAuth.ts` | useAuth hook returning the shared signed-in user, plus useOwnAuth, login and logout |

## Who reads this (all, generated)
- `AuthProvider.tsx` ← imported by `portal/src/App.tsx:29:d59841bd`
- `authContext.ts` ← imported by `portal/src/portal/analytics/AnalyticsOnlyGuard.tsx:3:6035b119` · `portal/src/portal/coach/card/harness.testdata.tsx:10:31538eab` · `portal/src/portal/coach/training/CoachAppGuard.tsx:3:7b8a1356` · `portal/src/portal/components/PortalLayout.tsx:5:6035b119` (+13: `python3 kg/kg.py who-reads authContext.ts`)
- `useAuth.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:5:9dad902b` · `portal/src/portal/auth/AnalyticsLogin.tsx:4:9dad902b` · `portal/src/portal/coach/CoachGate.tsx:3:e19b2fbe` · `portal/src/portal/coach/card/SlimHome.tsx:1:8a2e7934` (+36: `python3 kg/kg.py who-reads useAuth.ts`)

## Tests (all, generated)
- `AuthProvider.tsx` ← `portal/src/portal/components/PortalLayout.loading.test.tsx` · `portal/src/portal/hooks/AuthProvider.boot.test.tsx` · `portal/src/portal/hooks/AuthProvider.test.tsx` · `portal/src/portal/hooks/firstPage.test.tsx`
- `authContext.ts` ← `portal/src/portal/analytics/guard.test.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/coach/people/schoolsReady.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.loop.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.rm.test.tsx` (+3: `python3 kg/kg.py who-reads portal/src/portal/hooks/authContext.ts`)
- `useAuth.ts` ← `portal/src/portal/coach/CoachGate.test.tsx` · `portal/src/portal/coach/insights/tests/harness.tsx` · `portal/src/portal/coach/insights/tests/more.flagOff.test.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/coach/profile/CoachMore.test.tsx` · `portal/src/portal/coach/profile/CoachProfile.test.tsx` (+97: `python3 kg/kg.py who-reads portal/src/portal/hooks/useAuth.ts`)

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/analytics/CLAUDE.index.md`? · `portal/src/portal/analytics/CLAUDE.md`? · `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.index.md`? · `portal/src/portal/coach/people/CLAUDE.index.md`? · `portal/src/portal/coach/profile/CLAUDE.md`? · `portal/src/portal/coach/training/CLAUDE.index.md`? · `portal/src/portal/coach/training/CLAUDE.md`? · `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/hooks/CLAUDE.index.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/pages/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.index.md`?
