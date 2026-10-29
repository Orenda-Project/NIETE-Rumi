# pages — COACHIP page components: one file per screen
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/insights/pages kg=53db8c41724a gen=f05ae5fb152f overflow=12 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `ThisWeek.tsx` — S1, the coach's home when COACHIP is on
- `Weakness.tsx` — S2 one move in one fold; `Move.tsx` is S5
- No tests here; covered by ../tests via `cd portal && npx vitest run src/portal/coach/insights`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `ThisWeek.tsx` | S1 This week, the coach's COACHIP home: headline move, note, steps, phonics, not-yet |
| `Listen.tsx` | Listen tab: this week's moments across the coach's schools with W filter chips (G2) |
| `MomentRoute.tsx` | Route page for S4 at /portal/coach/insights/m/:momentId with app bar and moment player |
| `Move.tsx` | S5 the move: library intervention verbatim, check line, evidence, FLN send link (R9) |
| `Results.tsx` | S7 Results: children's reading checks one card per school-grade cell (R15) |
| `Schools.tsx` | Schools tab: every school in scope with last visit and its top weakness row |
| `Stats.tsx` | S6 Stats: this window per W versus last window when comparable (R14) |
| `ThisWeekAside.tsx` | Laptop right column of This week: inline moment player and open steps, lazy chunk |
| `Weakness.tsx` | S2 one move in one fold from GET /coachip/w/:wId with step card and moment |
| `Where.tsx` | S3 where it shows: schools listed in server order for one W |

## Who reads this (generated)
- `ThisWeek.tsx` ← imported by `portal/src/App.tsx:60:0759d285` · `portal/src/portal/coach/insights/routes.tsx:8:a22b9dba`
- `Listen.tsx` ← imported by `portal/src/portal/coach/insights/routes.tsx:13:a0b7ab81`
- `MomentRoute.tsx` ← imported by `portal/src/portal/coach/insights/routes.tsx:16:0cd79b0c`
- `Move.tsx` ← imported by `portal/src/portal/coach/insights/routes.tsx:11:65a79a05`
- … 6 more → `CLAUDE.index.md`

## Never (human)
- Rows keep the server's order, never sorted by a count (pages/Schools.tsx:15)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/tests/Listen.test.tsx`? (Listen.tsx)
- `portal/src/portal/coach/insights/tests/Move.test.tsx`? (Move.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/insights/CLAUDE.md`?
