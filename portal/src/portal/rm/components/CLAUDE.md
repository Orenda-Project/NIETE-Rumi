# components — RM page pieces: cards, rows, follow-up picker and frame
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/rm/components kg=44d5e2321540 gen=12689e95c4c4 overflow=6 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `FollowUpPicker.tsx` — picks template, W, schools and date; the server composes the note
- `RmFrame.tsx` — frame every RM page uses
- No tests here; covered by ../tests via `cd portal && npx vitest run src/portal/rm`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CountLine.tsx` | One activity line saying a Count in words under the DOM count contract |
| `RmFrame.tsx` | Frame of every RM page: COACHIP shell, RM menu, header, windows, trust line |
| `FollowUpPicker.tsx` | RM follow-up picker: template, W, one to three schools, date; posts exactly five keys |
| `SectorWRow.tsx` | Weakness row at sector scope for S8 month list and RM Stats |
| `WindowLegend.tsx` | Writes once on a card the windows its counts refer to, for data-win resolution |
| `CoachGroups.tsx` | S8 groups Which coach needs me: needs_me and on_track rows with follow-up buttons |
| `OpeningCard.tsx` | S8 opening sentence: schools visited, not-observed counts, floor line and coverage |
| `CircleRow.tsx` | One Friday-circle row with coach, school, W and a play button streaming the clip (S10) |
| … | 1 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `CountLine.tsx` ← imported by `portal/src/portal/rm/pages/RmCircle.tsx:18:2f1940f8` · `portal/src/portal/rm/pages/RmCoach.tsx:18:2f1940f8` (+3)
- `RmFrame.tsx` ← imported by `portal/src/portal/rm/pages/RmCircle.tsx:14:2e05ddbb` · `portal/src/portal/rm/pages/RmCoach.tsx:13:2e05ddbb` (+3)
- `FollowUpPicker.tsx` ← imported by `portal/src/portal/rm/pages/RmCoach.tsx:20:ff9fd010` · `portal/src/portal/rm/pages/RmCoaches.tsx:10:ff9fd010` (+1)
- `SectorWRow.tsx` ← imported by `portal/src/portal/rm/pages/RmCoach.tsx:17:0d1028a1` · `portal/src/portal/rm/pages/RmHome.tsx:18:a270a839` (+1)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- The picker previews only; compose.ts never sends the lines (../compose.ts:4, G8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/rm/tests/FollowUpPicker.test.tsx`? (FollowUpPicker.tsx)
- `portal/src/portal/rm/tests/r6_rm_deck.test.tsx` (OpeningCard.tsx)

## Related (generated)
- docs: `portal/src/portal/rm/CLAUDE.md`?
