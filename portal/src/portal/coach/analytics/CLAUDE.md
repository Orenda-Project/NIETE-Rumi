# analytics — Coach Analytics: lifetime numbers over the coach's own teachers

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/analytics kg=7ca2770b7a32 gen=60fda05f842d overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `CoachAnalytics.tsx` — list page and one-teacher page, school filter
- `model.ts` — KPI maths over GET /coach/people and /coach/teacher/:ext
- Test: `CoachAnalytics.test.tsx`; run `cd portal && npx vitest run src/portal/coach/analytics`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachAnalytics.test.tsx` | Pins coach Analytics: lifetime tiles, school filter, teacher rows, Not found for others (bd-fmf24g.27) |
| `CoachAnalytics.tsx` | Coach Analytics page and one-teacher view built from /coach/people and /coach/teacher/:ext (bd-fmf24g.27) |
| `model.ts` | Pure lifetime KPI and rating-chip maths for coach Analytics from the coach API rows (bd-fmf24g.27) |

## Who reads this (generated)
- `CoachAnalytics.tsx` ← imported by `portal/src/App.tsx:119:e97f5c5c`
- `model.ts` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:12:5a1e9705`

## Never (human)
- Counts are lifetime only, no date range or change pill (model.ts:8, bd-fmf24g.27)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/analytics/CoachAnalytics.test.tsx` (CoachAnalytics.tsx, model.ts)

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
