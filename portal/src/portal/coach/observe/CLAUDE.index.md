# observe — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/observe -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `ObservePage.tsx` | Frame of every Observe screen: coach gate, kit TeacherPage and the reports-waiting banner |
| `PlanState.tsx` | Row and chip showing what became of the coach's attached lesson plan: Reading, Read, Couldn't read (bd-fmf24g.66) |
| `checks.test.tsx` | Source-scan test that Observe screens keep kit design rules and hold no words in components (bd-4404s7.4) |
| `copy.test.ts` | Pins Observe copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.4) |
| `copy.ts` | All English and Urdu words of the coach Observe screens (hub, pick, visit, record, upload, send) |
| `format.ts` | Small formatters for visit day, recording length, plan kind and failure wording in Observe |
| `observeRoutes.tsx` | (unmapped) |
| `sender.test.ts` | Pins background observation sender: returns at once, retries same observation, frees phone copy (bd-4404s7.4) |
| `sender.ts` | Background sender running coachObserve.sendObservation with notices so leaving the page does not stop it |

## Who reads this (all, generated)
- `ObservePage.tsx` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:11:56e7ec98` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:21:56e7ec98` · `portal/src/portal/coach/pages/CoachObserve.tsx:10:56e7ec98` · `portal/src/portal/coach/pages/CoachObservePick.tsx:11:56e7ec98` (+3: `python3 kg/kg.py who-reads ObservePage.tsx`)
- `PlanState.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:25:43b31e37` · `portal/src/portal/coach/reports/FeedbackForm.tsx:17:6052db15`
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:9:62284d5a` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:19:555a148a` · `portal/src/portal/coach/pages/CoachObserve.tsx:8:62284d5a` · `portal/src/portal/coach/pages/CoachObservePick.tsx:9:62284d5a` (+9: `python3 kg/kg.py who-reads copy.ts`)
- `format.ts` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:10:98dc3f3f` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:20:f36ca8b9` · `portal/src/portal/coach/pages/CoachObserve.tsx:9:803bd941` · `portal/src/portal/coach/pages/CoachObservePick.tsx:10:803bd941` (+5: `python3 kg/kg.py who-reads format.ts`)
- `observeRoutes.tsx` ← imported by `portal/src/portal/coach/pages/CoachAttach.tsx:12:3d973a7c` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:22:3d973a7c` · `portal/src/portal/coach/pages/CoachObservation.tsx:2:3d973a7c` · `portal/src/portal/coach/pages/CoachRecord.tsx:13:3d973a7c` (+9: `python3 kg/kg.py who-reads observeRoutes.tsx`)
- `sender.ts` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:23:ffdb7ce5` · `portal/src/portal/coach/pages/CoachSending.tsx:11:7fb137e1` · `portal/src/portal/coach/pages/CoachVisit.tsx:17:5098ce77`

## Tests (all, generated)
- `copy.ts` ← `portal/src/portal/coach/observe/copy.test.ts` · `portal/src/portal/coach/reports/copy.test.ts` · `portal/src/portal/coach/uxMusts.test.tsx`
- `format.ts` ← `portal/src/portal/coach/observe/copy.test.ts`
- `sender.ts` ← `portal/src/portal/coach/observe/sender.test.ts` · `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachObserve.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/coach/pages/CoachOwnPlan.test.tsx` · `portal/src/portal/coach/uxMusts.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
