# schedule — Coach Schedule pieces: booked list, clash rules, tiles and copy
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/schedule kg=8b37c8ff7a61 gen=5c79f5b74013 overflow=6 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `model.ts` — pure clash and booked-on-day rules
- `copy.ts` — Schedule words in English and Urdu
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/schedule`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words of Schedule hub, My schedule, Team schedule, New visit and Done |
| `schedule.ur.test.tsx` | Pins the Schedule area in Urdu across hub, My schedule, Team schedule and New visit |
| `model.test.ts` | Pins schedule rules: bookedOn, clashesAt, sinceTone, sinceText, timeWords |
| `model.ts` | Pure schedule rules: booked visits per day, slot clashes, visit-age tone, time and day wording |
| `CancelVisitTray.tsx` | (unmapped) |
| `VisitCard.tsx` | (unmapped) |
| `copy.test.ts` | Pins Schedule copy: Urdu filled, locked words, operator's clash wording |
| `BookedList.tsx` | Already booked list on New visit step 3 plus the non-blocking Clash alert |
| `ScheduleTile.tsx` | One big door tile on the Schedule hub with a rose glyph and status chips |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:8:7d7e157d` · `portal/src/portal/coach/flow/FocusCard.tsx:12:7d7e157d` (+12)
- `model.ts` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:9:4d6c2348` · `portal/src/portal/coach/pages/CoachNewVisit.tsx:21:8078f905` (+3)
- `CancelVisitTray.tsx` ← imported by `portal/src/portal/coach/pages/CoachObserveToday.tsx:17:9cb7ca41` · `portal/src/portal/coach/pages/CoachVisit.tsx:13:9cb7ca41`
- `VisitCard.tsx` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:10:6a268281` · `portal/src/portal/coach/pages/CoachNewVisit.tsx:18:1e33cc90`
- … 2 more → `CLAUDE.index.md`

## Never (human)
- A clash warns, never blocks (schedule/BookedList.tsx:12, operator 9 Oct)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/schedule/model.test.ts` (copy.ts, model.ts)
- `portal/src/portal/coach/flow/flowV2.test.tsx` (copy.ts)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
