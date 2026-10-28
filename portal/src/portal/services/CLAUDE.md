# services — Portal HTTP client: every API call the portal makes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/services kg=90b4308a7ff0 gen=0f412316ac38 overflow=259 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `api.ts` — axios client with namespaces auth, portal, leader, coach, analytics, childTest
- Tests api.*.test.ts; run `cd portal && npx vitest run src/portal/services`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `api*` | 6 files; most used `api.ts`: Portal axios client: auth, language, portal, analytics, leader, coach, classes, child test namespaces |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `api.ts` ← imported by `portal/src/App.tsx:35:53c61c93` · `portal/src/components/LanguageSwitcher.tsx:12:8d38d8b5` (+182)

## Never (human)
- Native builds need an absolute API base URL; getApiBaseUrl fails loudly if missing (api.ts:19)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/analytics/LpEngagement.test.tsx` (api.ts)
- `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` (api.ts)
- `portal/src/portal/analytics/entry.test.tsx` (api.ts)
- `portal/src/portal/analytics/views/TrainingTab.test.tsx` (api.ts)
- `portal/src/portal/auth/analytics-login.route.test.tsx` (api.ts)
- `portal/src/portal/coach/PendingBanner.test.tsx` (api.ts)
- `portal/src/portal/coach/analytics/CoachAnalytics.test.tsx` (api.ts)
- `portal/src/portal/coach/canvasColours.test.tsx` (api.ts)
- `portal/src/portal/coach/disagreements/api.test.ts` (api.ts)
- `portal/src/portal/coach/home/CoachHome.test.tsx` (api.ts)
- `portal/src/portal/coach/insights/tests/harness.tsx` (api.ts)
- `portal/src/portal/coach/insights/tests/more.flagOff.test.tsx` (api.ts)
- `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` (api.ts)
- `portal/src/portal/coach/pages/CoachBack.test.tsx` (api.ts)
- `portal/src/portal/coach/pages/CoachEditTeacher.test.tsx` (api.ts)
- `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` (api.ts)
- … 259 more → `CLAUDE.index.md`

## Related (generated)
- docs: `docs/migration/09a-capacitor-wrapping.md`? · `docs/migration/CLAUDE.index.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/analytics/CLAUDE.index.md`? · `portal/src/portal/analytics/views/CLAUDE.index.md`? · `portal/src/portal/analytics/views/CLAUDE.md`? (+10)
