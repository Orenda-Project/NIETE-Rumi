# services — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/services -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `api.analytics.test.ts` | Pins analytics.getSchools and getCoaching sending window and region (bd-s6qbts.3) |
| `api.analyticsLogin.test.ts` | Pins that a 401 on the analytics sign-in page does not redirect to teacher login |
| `api.config.test.ts` | Pins that portal.getConfig falls back to every feature off, newUi false (bd-5rz1v.12) |
| `api.generate.test.ts` | Pins that generateAssessment refusals keep the error and expose code, status, retry time |
| `api.trainingLink.test.ts` | Pins that a 401 from a training-link session goes to /t, others to password login |
| `api.ts` | Portal axios client: auth, language, portal, analytics, leader, coach, classes, child test namespaces |

## Who reads this (all, generated)
- `api.ts` ← imported by `portal/src/App.tsx:35:53c61c93` · `portal/src/components/LanguageSwitcher.tsx:12:8d38d8b5` · `portal/src/portal/analytics/SchoolsAnalytics.tsx:7:d6c90125` · `portal/src/portal/analytics/views/LpTab.tsx:3:bb503092` (+180: `python3 kg/kg.py who-reads api.ts`)

## Tests (all, generated)
- `api.ts` ← `portal/src/portal/analytics/LpEngagement.test.tsx` · `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` · `portal/src/portal/analytics/entry.test.tsx` · `portal/src/portal/analytics/views/TrainingTab.test.tsx` · `portal/src/portal/auth/analytics-login.route.test.tsx` · `portal/src/portal/coach/PendingBanner.test.tsx` (+270: `python3 kg/kg.py who-reads portal/src/portal/services/api.ts`)

## Related (all, generated)
- docs: `docs/migration/09a-capacitor-wrapping.md`? · `portal/src/portal/CLAUDE.md`?
