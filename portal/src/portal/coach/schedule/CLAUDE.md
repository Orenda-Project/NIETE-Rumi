# schedule — Coach Schedule pieces: booked list, clash rules, tiles and copy

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/schedule kg=95bcdebaae7c gen=eaa6e2ee621a overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `copy.test.ts` | Pins Schedule copy: Urdu filled, locked words, operator's clash wording |
| `BookedList.tsx` | Already booked list on New visit step 3 plus the non-blocking Clash alert |
| `ScheduleTile.tsx` | One big door tile on the Schedule hub with a rose glyph and status chips |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachNewVisit.tsx:13:7d7e157d` · `portal/src/portal/coach/pages/CoachSchedule.tsx:9:c5196a0c` (+4)
- `model.ts` ← imported by `portal/src/portal/coach/pages/CoachNewVisit.tsx:15:8078f905` · `portal/src/portal/coach/pages/CoachSchedule.tsx:10:4d6c2348` (+1)
- `BookedList.tsx` ← imported by `portal/src/portal/coach/pages/CoachNewVisit.tsx:14:e5beee83`
- `ScheduleTile.tsx` ← imported by `portal/src/portal/coach/pages/CoachScheduling.tsx:7:c88c3aa1`

## Never (human)
- A clash warns, never blocks (schedule/BookedList.tsx:12, operator 9 Oct)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/schedule/model.test.ts` (copy.ts, model.ts)
- `portal/src/portal/coach/schedule/copy.test.ts` (copy.ts)
- `portal/src/portal/coach/schedule/schedule.ur.test.tsx` (copy.ts)

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
