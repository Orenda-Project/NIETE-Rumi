# pages — RM page components: Sector, Coaches, one coach, Circle, Stats

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/rm/pages kg=f7ca1320805a gen=c8e6553e7a1c overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `RmHome.tsx` — S8 Monday sector card
- `RmCoach.tsx` — S9 one coach; `RmCircle.tsx` is S10
- No tests here; covered by ../tests via `cd portal && npx vitest run src/portal/rm`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `RmCircle.tsx` | S10 Friday coach circle: one moment per coach, sector moves, Set this sector step |
| `RmCoach.tsx` | S9 one coach for the RM: schools, steps, moves, follow-ups and Send follow-up |
| `RmCoaches.tsx` | Coaches tab showing S8's two coach groups on their own page |
| `RmHome.tsx` | S8 RM Monday sector card: opening, month moves, coach groups, circle and cluster cards |
| `RmStats.tsx` | RM Stats at sector scope from the R17 sector rows, with the scoring-changed marker |

## Who reads this (generated)
- `RmCircle.tsx` ← imported by `portal/src/portal/rm/routes.tsx:12:4ccfd55a`
- `RmCoach.tsx` ← imported by `portal/src/portal/rm/routes.tsx:11:deafc7f5`
- `RmCoaches.tsx` ← imported by `portal/src/portal/rm/routes.tsx:10:94a8b246`
- `RmHome.tsx` ← imported by `portal/src/portal/rm/routes.tsx:9:6e391171`
- `RmStats.tsx` ← imported by `portal/src/portal/rm/routes.tsx:13:f31c4470`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/rm/tests/RmCircle.test.tsx`? (RmCircle.tsx)
- `portal/src/portal/rm/tests/RmCoach.test.tsx`? (RmCoach.tsx)
- `portal/src/portal/rm/tests/RmHome.test.tsx`? (RmHome.tsx)
- `portal/src/portal/rm/tests/RmStats.test.tsx`? (RmStats.tsx)

## Related (generated)
- docs: `portal/src/portal/rm/CLAUDE.md`?
