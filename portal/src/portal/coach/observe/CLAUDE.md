# observe — Observe frame, copy and background sender for the coach's observations
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/observe kg=fbdcaff03554 gen=6727e1ca87f9 overflow=33 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `sender.ts` — sends an observation in the background so leaving the page does not stop it
- `copy.ts` — every Observe word; `ObservePage.tsx` is the frame
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/observe`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | All English and Urdu words of the coach Observe screens (hub, pick, visit, record, upload, send) |
| `observeRoutes.tsx` | (unmapped) |
| `sender.ts` | Background sender running coachObserve.sendObservation with notices so leaving the page does not stop it |
| `format.ts` | Small formatters for visit day, recording length, plan kind and failure wording in Observe |
| `ObservePage.tsx` | Frame of every Observe screen: coach gate, kit TeacherPage and the reports-waiting banner |
| `ContinueOnWhatsApp.test.tsx` | (unmapped) |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/flow/BookedRow.tsx:7:62284d5a` · `portal/src/portal/coach/pages/CoachAttach.tsx:9:62284d5a` (+17)
- `observeRoutes.tsx` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:12:3d973a7c` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:27:3d973a7c` (+12)
- `ObservePage.tsx` ← imported by `portal/src/portal/coach/flow/routes.tsx:8:56e7ec98` · `portal/src/portal/coach/pages/CoachAttach.tsx:11:56e7ec98` (+9)
- `format.ts` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:10:98dc3f3f` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:23:6bc0dd9f` (+8)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- Words live in copy.ts, none written into components (observe/checks.test.tsx, bd-4404s7.4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/observe/startRetry.test.ts` (copy.ts, format.ts, sender.ts)
- `portal/src/portal/coach/pages/CoachAndroidFiles.test.tsx` (copy.ts, format.ts, sender.ts)
- … 18 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/lib/CLAUDE.md`? · `portal/src/portal/coach/CLAUDE.md`?
