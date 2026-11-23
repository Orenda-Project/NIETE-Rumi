# reports — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/reports -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CoachReportsAll.test.tsx` | Pins All Observations: date range, search, four numbers with change, rows by day (bd-4404s7.5) |
| `CoachReportsAll.tsx` | All Observations page with date range bar, search, KPI numbers and rows by day |
| `Debrief.test.tsx` | Pins Debrief step: guide, Start/Upload recording, file to R2, failure and retry paths |
| `Debrief.tsx` | Debrief step 3 of 5: guide, record or upload the talk with the teacher, send to the Digital Coach |
| `FeedbackForm.autosave.test.tsx` | (unmapped) |
| `FeedbackForm.test.tsx` | Pins Feedback Form: step bar, plan moves, rating scale, change counting, read-only after send |
| `FeedbackForm.tsx` | Feedback Form step 2 of 5: WhatsApp review form in the portal, saving r_/ev_/imp_/fid_ keys |
| `FeedbackForm.v6.test.tsx` | (unmapped) |
| `FeedbackForm.v6notes.test.tsx` | (unmapped) |
| `InsightRow.tsx` | One toned labelled line used by Debrief guide, feedback and report preview |
| `Obs612Form.test.tsx` | (unmapped) |
| `Obs612Form.tsx` | (unmapped) |
| `ReportRows.tsx` | Reports list rows and cards on kit HistoryRow, with chips and segments |
| `ReportsFrame.tsx` | Shared frame of Reports screens with coach gate, TeacherPage and pending-reports banner |
| `RubricGuide.tsx` | (unmapped) |
| `SendReport.test.tsx` | Pins Send report step: preview, To teacher, send once, retry and failure states |
| `SendReport.tsx` | Send report step 5 of 5: previews the bot-made report image then sends on WhatsApp |
| `V6Parts.tsx` | (unmapped) |
| `YourFeedback.test.tsx` | Pins Your feedback step: praise, wins, try-next, question or concern, dock behaviour |
| `YourFeedback.tsx` | Your feedback step 4 of 5: what the Digital Coach says about the coach's debrief |
| `copy.test.ts` | Pins Reports copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.5) |
| `copy.ts` | English and Urdu words for all coach Reports screens and the four observation steps |
| `data.test.ts` | Pins Reports arithmetic: Pakistan day grouping, spans, KPI numbers, load-more rule |
| `data.ts` | Reports list arithmetic from GET /api/portal/coach/reports rows: day groups, spans, KPIs |
| `formKeep.ts` | (unmapped) |
| `formModel.ts` | Feedback Form values and keys identical to the WhatsApp review form, with change counting |
| `paths.ts` | Route paths of Reports and the observation's screens under /portal/coach/observation/:id |
| `routes.test.ts` | Pins that every Reports screen has a lazy route that gates itself through ReportsFrame |
| `useAllReports.ts` | Pages through coach reports newest first, 30 per page, until the comparison period is covered |
| `useObservationView.ts` | Reads one observation from GET /leader/observe/:id, re-reading every 8 s while the worker owns the step |
| `v6Model.ts` | (unmapped) |

## Who reads this (all, generated)
- `CoachReportsAll.tsx` ← imported by `portal/src/App.tsx:145:a2685529`
- `Debrief.tsx` ← imported by `portal/src/App.tsx:147:d0a5d3f5` · `portal/src/portal/teacher/principal/routes.tsx:18:8d428bfb`
- `FeedbackForm.tsx` ← imported by `portal/src/App.tsx:146:c35841a3` · `portal/src/portal/teacher/principal/routes.tsx:17:750958e6`
- `InsightRow.tsx` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:24:a78567ff` · `portal/src/portal/coach/reports/RubricGuide.tsx:4:a78567ff` · `portal/src/portal/coach/reports/YourFeedback.tsx:9:a78567ff`
- `Obs612Form.tsx` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:21:08f0da49`
- `ReportRows.tsx` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:14:340346ae` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:19:cf3a337b` · `portal/src/portal/coach/pages/CoachReports.tsx:14:9602a3b5` · `portal/src/portal/teacher/principal/PickTeacher.tsx:19:fb9c0d63` (+2: `python3 kg/kg.py who-reads ReportRows.tsx`)
- `ReportsFrame.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:21:f774c913` · `portal/src/portal/coach/pages/CoachReports.tsx:13:f774c913` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:11:b1892bfc` · `portal/src/portal/coach/reports/Debrief.tsx:23:b1892bfc` (+4: `python3 kg/kg.py who-reads ReportsFrame.tsx`)
- `RubricGuide.tsx` ← imported by `portal/src/portal/pages/LeaderObserveTalk.tsx:18:f3209b16` · `portal/src/portal/coach/reports/Debrief.tsx:25:d5aad2f5`
- `SendReport.tsx` ← imported by `portal/src/App.tsx:149:1bb5f58e` · `portal/src/portal/teacher/principal/routes.tsx:20:1ea3eb4b`
- `V6Parts.tsx` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:19:d3f30783`
- `YourFeedback.tsx` ← imported by `portal/src/App.tsx:148:459c7642` · `portal/src/portal/teacher/principal/routes.tsx:19:0d0e78e9`
- `copy.ts` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:13:8498d38a` · `portal/src/portal/coach/pages/CoachObservation.tsx:22:8498d38a` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:18:8498d38a` · `portal/src/portal/coach/pages/CoachReports.tsx:15:8498d38a` (+12: `python3 kg/kg.py who-reads copy.ts`)
- `data.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:23:338b8369` · `portal/src/portal/coach/pages/CoachReports.tsx:16:e5be9041` · `portal/src/portal/teacher/principal/PrincipalObservations.tsx:22:35687b1b` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:14:4c69f773` (+2: `python3 kg/kg.py who-reads data.ts`)
- `formKeep.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:14:07d4985f`
- `formModel.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:15:e7ff8a33` · `portal/src/portal/coach/reports/Obs612Form.tsx:12:3f46c817` · `portal/src/portal/coach/reports/V6Parts.tsx:9:d2ede4bd` · `portal/src/portal/coach/reports/v6Model.ts:2:d2ede4bd`
- `paths.ts` ← imported by `portal/src/portal/coach/observe/observeRoutes.tsx:5:6ff88a29` · `portal/src/portal/coach/pages/CoachObservation.tsx:24:80318d32` · `portal/src/portal/teacher/principal/observe.tsx:8:cdb0e197` · `portal/src/portal/coach/reports/Debrief.tsx:27:47a3432e` (+4: `python3 kg/kg.py who-reads paths.ts`)
- `useAllReports.ts` ← imported by `portal/src/portal/coach/reports/CoachReportsAll.tsx:15:689afdb1`
- `useObservationView.ts` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:28:5676cf52` · `portal/src/portal/coach/reports/FeedbackForm.tsx:17:11810407` · `portal/src/portal/coach/reports/SendReport.tsx:19:5676cf52` · `portal/src/portal/coach/reports/YourFeedback.tsx:12:11810407`
- `v6Model.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:20:9e05b77a` · `portal/src/portal/coach/reports/V6Parts.tsx:10:8ac448bc` · `portal/src/portal/coach/reports/formModel.ts:2:b6decddb`

## Tests (all, generated)
- `CoachReportsAll.tsx` ← `portal/src/portal/coach/reports/CoachReportsAll.test.tsx`
- `Debrief.tsx` ← `portal/src/portal/coach/reports/Debrief.test.tsx`
- `FeedbackForm.tsx` ← `portal/src/portal/coach/reports/FeedbackForm.autosave.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.v6.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.v6notes.test.tsx` · `portal/src/portal/coach/reports/Obs612Form.test.tsx`
- `Obs612Form.tsx` ← `portal/src/portal/coach/reports/Obs612Form.test.tsx`?
- `ReportRows.tsx` ← `portal/src/portal/coach/pages/CoachObservation.obs612.test.tsx` · `portal/src/portal/coach/pages/CoachObservation.steps4.test.tsx`
- `ReportsFrame.tsx` ← `portal/src/portal/coach/uxMusts.test.tsx`
- `SendReport.tsx` ← `portal/src/portal/coach/reports/SendReport.test.tsx` · `portal/src/portal/teacher/principal/PrincipalScores.test.tsx`
- `YourFeedback.tsx` ← `portal/src/portal/coach/reports/YourFeedback.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/pages/CoachObservation.obs612.test.tsx` · `portal/src/portal/coach/reports/copy.test.ts` · `portal/src/portal/coach/uxMusts.test.tsx`
- `data.ts` ← `portal/src/portal/coach/reports/data.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
