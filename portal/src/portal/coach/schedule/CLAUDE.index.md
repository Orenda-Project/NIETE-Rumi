# schedule — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/schedule -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `BookedList.tsx` | Already booked list on New visit step 3 plus the non-blocking Clash alert |
| `CancelVisitTray.tsx` | (unmapped) |
| `ScheduleTile.tsx` | One big door tile on the Schedule hub with a rose glyph and status chips |
| `VisitCard.tsx` | (unmapped) |
| `copy.test.ts` | Pins Schedule copy: Urdu filled, locked words, operator's clash wording |
| `copy.ts` | English and Urdu words of Schedule hub, My schedule, Team schedule, New visit and Done |
| `model.test.ts` | Pins schedule rules: bookedOn, clashesAt, sinceTone, sinceText, timeWords |
| `model.ts` | Pure schedule rules: booked visits per day, slot clashes, visit-age tone, time and day wording |
| `schedule.ur.test.tsx` | Pins the Schedule area in Urdu across hub, My schedule, Team schedule and New visit |

## Who reads this (all, generated)
- `BookedList.tsx` ← imported by `portal/src/portal/coach/pages/CoachNewVisit.tsx:20:e5beee83`
- `CancelVisitTray.tsx` ← imported by `portal/src/portal/coach/pages/CoachObserveToday.tsx:18:9cb7ca41` · `portal/src/portal/coach/pages/CoachVisit.tsx:13:9cb7ca41`
- `ScheduleTile.tsx` ← imported by `portal/src/portal/coach/pages/CoachScheduling.tsx:7:c88c3aa1`
- `VisitCard.tsx` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:10:0c922937` · `portal/src/portal/coach/pages/CoachNewVisit.tsx:18:1e33cc90`
- `copy.ts` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:8:7d7e157d` · `portal/src/portal/coach/flow/FocusCard.tsx:12:7d7e157d` · `portal/src/portal/coach/flow/routes.tsx:9:7d7e157d` · `portal/src/portal/coach/observe/KeptRows.tsx:17:7d7e157d` (+13: `python3 kg/kg.py who-reads copy.ts`)
- `model.ts` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:9:4d6c2348` · `portal/src/portal/coach/pages/CoachNewVisit.tsx:21:8078f905` · `portal/src/portal/coach/pages/CoachSchedule.tsx:10:4d6c2348` · `portal/src/portal/coach/pages/CoachTeam.tsx:11:91fdc6ae` (+1: `python3 kg/kg.py who-reads model.ts`)

## Tests (all, generated)
- `copy.ts` ← `portal/src/portal/coach/flow/flowV2.test.tsx` · `portal/src/portal/coach/flow/v6.test.tsx` · `portal/src/portal/coach/schedule/copy.test.ts` · `portal/src/portal/coach/schedule/model.test.ts` · `portal/src/portal/coach/schedule/schedule.ur.test.tsx` · `portal/src/portal/coach/uxMusts.test.tsx`
- `model.ts` ← `portal/src/portal/coach/schedule/model.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
