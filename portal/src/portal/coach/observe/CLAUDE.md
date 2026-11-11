# observe — Observe frame, copy and background sender for the coach's observations
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/observe kg=35967943bfda gen=e3bcf20cb5ce overflow=8 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `sender.ts` — sends an observation in the background so leaving the page does not stop it
- `copy.ts` — every Observe word; `ObservePage.tsx` is the frame
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/observe`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | All English and Urdu words of the coach Observe screens (hub, pick, visit, record, upload, send) |
| `format.ts` | Small formatters for visit day, recording length, plan kind and failure wording in Observe |
| `sender.test.ts` | Pins background observation sender: returns at once, retries same observation, frees phone copy (bd-4404s7.4) |
| `sender.ts` | Background sender running coachObserve.sendObservation with notices so leaving the page does not stop it |
| `ObservePage.tsx` | Frame of every Observe screen: coach gate, kit TeacherPage and the reports-waiting banner |
| `copy.test.ts` | Pins Observe copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.4) |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:10:62284d5a` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:19:555a148a` (+9)
- `format.ts` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:11:98dc3f3f` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:20:f36ca8b9` (+7)
- `ObservePage.tsx` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:12:56e7ec98` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:21:56e7ec98` (+5)
- `sender.ts` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:22:ac328f0a` · `portal/src/portal/coach/pages/CoachSending.tsx:10:7fb137e1` (+1)
- … 1 more → `CLAUDE.index.md`

## Never (human)
- Words live in copy.ts, none written into components (observe/checks.test.tsx, bd-4404s7.4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/observe/copy.test.ts` (copy.ts, format.ts)
- `portal/src/portal/coach/observe/sender.test.ts` (sender.ts)
- … 5 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
