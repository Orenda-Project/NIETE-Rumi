# home — Coach Home on the kit: visits today and feature tiles

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/home kg=06649af58249 gen=7bb4ba46c734 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

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
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachHome.tsx:15:130de9ad` · `portal/src/portal/coach/ui.tsx:11:cee179ec` (+2)
- `VisitCards.tsx` ← imported by `portal/src/portal/coach/pages/CoachHome.tsx:16:6141706a`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
