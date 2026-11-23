# reports — Coach Reports lists and the four observation steps (form, debrief, feedback, send)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/reports kg=dc5784911efe gen=8ae051a4b67e overflow=51 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `FeedbackForm.tsx` — step 2; `Debrief.tsx` 3; `YourFeedback.tsx` 4; `SendReport.tsx` 5
- `data.ts` — Pakistan-day grouping and KPI maths for the lists
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/reports`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words for all coach Reports screens and the four observation steps |
| `ReportsFrame.tsx` | Shared frame of Reports screens with coach gate, TeacherPage and pending-reports banner |
| `ReportRows.tsx` | Reports list rows and cards on kit HistoryRow, with chips and segments |
| `paths.ts` | Route paths of Reports and the observation's screens under /portal/coach/observation/:id |
| `FeedbackForm*` | 5 files; most used `FeedbackForm.tsx`: Feedback Form step 2 of 5: WhatsApp review form in the portal, saving r_/ev_/imp_/fid_ keys |
| … | 26 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:13:8498d38a` · `portal/src/portal/coach/pages/CoachObservation.tsx:22:8498d38a` (+14)
- `ReportsFrame.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:21:f774c913` · `portal/src/portal/coach/pages/CoachReports.tsx:13:f774c913` (+6)
- `paths.ts` ← imported by `portal/src/portal/coach/observe/observeRoutes.tsx:5:6ff88a29` · `portal/src/portal/coach/pages/CoachObservation.tsx:24:80318d32` (+6)
- … 16 more → `CLAUDE.index.md`

## Never (human)
- Form keys must equal the WhatsApp review form's keys (reports/formModel.ts:4)
- Nothing is sent to a teacher until the coach taps Send (reports/SendReport.tsx:25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachObservation.obs612.test.tsx` (ReportRows.tsx, copy.ts)
- `portal/src/portal/coach/reports/Obs612Form.test.tsx`? (FeedbackForm.tsx, Obs612Form.tsx)
- … 13 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
