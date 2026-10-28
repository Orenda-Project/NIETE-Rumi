# hooks — Auth hooks: the signed-in user is read once and shared
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/hooks kg=70f453bad378 gen=5f128e763a4f overflow=108 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `AuthProvider.tsx` — reads the user once per visit above all routes
- `useAuth.ts` — hook, login and logout used by pages
- Tests colocated; run `cd portal && npx vitest run src/portal/hooks`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `useAuth.ts` | useAuth hook returning the shared signed-in user, plus useOwnAuth, login and logout |
| `authContext.ts` | Context object for the user PortalLayout loaded, in its own module so mocks keep it real |
| `CLAUDE.index.md` | (unmapped) |
| `firstPage.test.tsx` | Pins first-page loading: /me instead of /dashboard, parallel /config, 30 s reuse (bd-fxk3t8) |
| `CLAUDE.md` | (unmapped) |
| `AuthProvider*` | 3 files; most used `AuthProvider.tsx`: Root provider holding the signed-in user once per visit above all routes (bd-fxk3t8) |

## Who reads this (generated)
- `useAuth.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:5:9dad902b` · `portal/src/portal/auth/AnalyticsLogin.tsx:4:9dad902b` (+38)
- `authContext.ts` ← imported by `portal/src/portal/analytics/AnalyticsOnlyGuard.tsx:3:6035b119` · `portal/src/portal/coach/card/harness.testdata.tsx:10:31538eab` (+15)
- `AuthProvider.tsx` ← imported by `portal/src/App.tsx:29:d59841bd`

## Never (human)
- Read the user once per visit; pages must not re-fetch /dashboard (AuthProvider.tsx:8, bd-fxk3t8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` (authContext.ts, useAuth.ts)
- `portal/src/portal/hooks/AuthProvider.test.tsx` (AuthProvider.tsx, useAuth.ts)
- `portal/src/portal/hooks/firstPage.test.tsx` (AuthProvider.tsx, useAuth.ts)
- `portal/src/portal/analytics/guard.test.tsx` (authContext.ts)
- `portal/src/portal/coach/CoachGate.test.tsx` (useAuth.ts)
- … 108 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/analytics/CLAUDE.index.md`? · `portal/src/portal/analytics/CLAUDE.md`? · `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.index.md`? · `portal/src/portal/coach/people/CLAUDE.index.md`? (+8)
