# home — Coach Home on the kit: visits today and feature tiles

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/home kg=30763dacdd0f gen=6b32c302bdf1 overflow=0 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `copy.ts` — Home and reports-waiting words in English and Urdu
- `VisitCards.tsx` — visit rows used by pages/CoachHome.tsx
- Test: `CoachHome.test.tsx`; run `cd portal && npx vitest run src/portal/coach/home`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachHome.test.tsx` | Pins the kit-based coach Home: band, waiting banner, today's visits, five tiles, Urdu (bd-4404s7.2) |
| `copy.ts` | English and Urdu words of the coach Home and its reports-waiting notice (bd-4404s7.2) |
| `VisitCards.tsx` | Coach Home visit rows as kit HistoryRows and the expanded current visit (bd-4404s7.2) |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:15:130de9ad` · `portal/src/portal/coach/pages/CoachHome.tsx:15:130de9ad` (+3)
- `VisitCards.tsx` ← imported by `portal/src/portal/coach/pages/CoachHome.tsx:16:6141706a`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/uxMusts.test.tsx` (copy.ts)

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
