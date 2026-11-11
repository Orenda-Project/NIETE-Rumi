# analytics — Teacher Analytics page (More > Analytics) and the principal's My school view
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/analytics kg=73833ae1b592 gen=9eb569cb33db overflow=21 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `AnalyticsPage.tsx` — page at /portal/teacher/analytics: tiles from /progress and /my-analytics
- `model.ts` — pure KPI, band and trend shaping; `SchoolView.tsx` — principal view
- `model.test.ts` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/analytics`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words for the teacher Analytics page (ANALYTICS_V2_COPY, COPY_ENTRY registered for Urdu checks) |
| `AnalyticsPage.test.tsx` | Tests AnalyticsPage: /progress and /my-analytics tiles, default range, Back to More (bd-fmf24g.8) |
| `SchoolView.test.tsx` | Tests the principal's Analytics: My school | Me tabs, server-owned school (no school param sent), teacher row opens one |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:6:ee0fbe19` · `portal/src/portal/coach/analytics/model.ts:4:27fcf88e` (+5)
- `model.ts` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:8:c1135b8e` · `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:27:74d4b72c` (+3)
- `paths.ts` ← imported by `portal/src/portal/teacher/analytics/SchoolView.tsx:14:d1cdb2f6` · `portal/src/portal/teacher/analytics/routes.tsx:2:ac2d7d9e` (+1)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- Ratings show as bands, never numbers; a missing count stays empty, not 0 (model.ts:11-12)
- The principal's school is the server's from the session; no school param is sent (SchoolView.tsx:22-24)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/analytics/SchoolView.test.tsx`? (SchoolView.tsx, copy.ts, paths.ts, routes.tsx, school.ts)
- `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx`? (AnalyticsPage.tsx, copy.ts, paths.ts, routes.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/home/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
