# services — Portal HTTP client: every API call the portal makes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/services kg=cc19c26af403 gen=6df94e9ca8b1 overflow=391 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `api.ts` — axios client with namespaces auth, portal, leader, coach, analytics, childTest
- Tests api.*.test.ts; run `cd portal && npx vitest run src/portal/services`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `api*` | 6 files; most used `api.ts`: Portal axios client: auth, language, portal, analytics, leader, coach, classes, child test namespaces |

## Who reads this (generated)
- `api.ts` ← imported by `portal/src/App.tsx:35:53c61c93` · `portal/src/components/LanguageSwitcher.tsx:12:8d38d8b5` (+226)

## Never (human)
- Native builds need an absolute API base URL; getApiBaseUrl fails loudly if missing (api.ts:19)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/analytics/LpEngagement.test.tsx` (api.ts)
- `portal/src/portal/analytics/MoawinView.test.tsx` (api.ts)
- `portal/src/portal/analytics/SchoolsAnalytics.test.tsx` (api.ts)
- `portal/src/portal/analytics/entry.test.tsx` (api.ts)
- `portal/src/portal/analytics/journey/JourneySection.test.tsx` (api.ts)
- `portal/src/portal/analytics/views/TrainingTab.test.tsx` (api.ts)
- `portal/src/portal/auth/analytics-login.route.test.tsx` (api.ts)
- `portal/src/portal/coach/PendingBanner.test.tsx` (api.ts)
- `portal/src/portal/coach/analytics/CoachAnalytics.test.tsx` (api.ts)
- `portal/src/portal/coach/canvasColours.test.tsx` (api.ts)
- `portal/src/portal/coach/coachTraining/CoachTrainingModulePage.test.tsx` (api.ts)
- `portal/src/portal/coach/coachTraining/CoachTrainingPage.test.tsx` (api.ts)
- `portal/src/portal/coach/disagreements/api.test.ts` (api.ts)
- `portal/src/portal/coach/feedback/FeedbackPage.test.tsx` (api.ts)
- `portal/src/portal/coach/flow/concept1.test.tsx` (api.ts)
- `portal/src/portal/coach/flow/flowV2.test.tsx` (api.ts)
- `portal/src/portal/coach/flow/inProgress45.test.tsx` (api.ts)
- `portal/src/portal/coach/flow/schoolSearch.bfagiy.test.tsx` (api.ts)
- `portal/src/portal/coach/flow/stopped245.test.tsx` (api.ts)
- `portal/src/portal/coach/flow/v6.test.tsx` (api.ts)
- … 391 more → `CLAUDE.index.md`

## Related (generated)
- docs: `docs/migration/09a-capacitor-wrapping.md`? · `portal/src/portal/CLAUDE.md`?
