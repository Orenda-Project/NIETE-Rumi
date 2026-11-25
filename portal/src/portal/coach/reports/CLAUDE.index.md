# reports — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/reports -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__snapshots__/` | → (not mapped: excluded; 1 files) |
| `CoachReportsAll.test.tsx` | Pins All Observations: date range, search, four numbers with change, rows by day (bd-4404s7.5) |
| `CoachReportsAll.tsx` | All Observations page with date range bar, search, KPI numbers and rows by day |
| `Debrief.stay39.test.tsx` | (unmapped) |
| `Debrief.test.tsx` | Pins Debrief step: guide, Start/Upload recording, file to R2, failure and retry paths |
| `Debrief.tsx` | Debrief step 3 of 5: guide, record or upload the talk with the teacher, send to the Digital Coach |
| `FeedbackForm.about37.test.tsx` | (unmapped) |
| `FeedbackForm.autosave.test.tsx` | (unmapped) |
| `FeedbackForm.checklist46.test.tsx` | (unmapped) |
| `FeedbackForm.dc36.test.tsx` | (unmapped) |
| `FeedbackForm.dcEvidence39.test.tsx` | (unmapped) |
| `FeedbackForm.evidence.test.ts` | (unmapped) |
| `FeedbackForm.ffv7.test.tsx` | (unmapped) |
| `FeedbackForm.ficos40.test.tsx` | (unmapped) |
| `FeedbackForm.phoneBack48.test.tsx` | (unmapped) |
| `FeedbackForm.saveLimit38.test.tsx` | (unmapped) |
| `FeedbackForm.test.tsx` | Pins Feedback Form: step bar, plan moves, rating scale, change counting, read-only after send |
| `FeedbackForm.tsx` | Feedback Form step 2 of 5: WhatsApp review form in the portal, saving r_/ev_/imp_/fid_ keys |
| `FeedbackForm.v6.test.tsx` | (unmapped) |
| `FeedbackForm.v6notes.test.tsx` | (unmapped) |
| `FeedbackForm.v7.test.tsx` | (unmapped) |
| `FeedbackForm.waitsForDc41.test.tsx` | (unmapped) |
| `FormToast.clear48.test.tsx` | (unmapped) |
| `FormToast.swipe40.test.tsx` | (unmapped) |
| `FormV7.nextOneLine48.test.tsx` | (unmapped) |
| `FormV7.tsx` | (unmapped) |
| `FormV7List.tsx` | (unmapped) |
| `FormV7Nav.tsx` | (unmapped) |
| `InsightRow.tsx` | One toned labelled line used by Debrief guide, feedback and report preview |
| `Obs612Form.ffv7.test.tsx` | (unmapped) |
| `Obs612Form.ficos12.test.tsx` | (unmapped) |
| `Obs612Form.test.tsx` | (unmapped) |
| `Obs612Form.tsx` | (unmapped) |
| `ReportImage.test.tsx` | (unmapped) |
| `ReportImage.tsx` | (unmapped) |
| `ReportRows.tsx` | Reports list rows and cards on kit HistoryRow, with chips and segments |
| `ReportsFrame.dockSpace40.test.tsx` | (unmapped) |
| `ReportsFrame.tsx` | Shared frame of Reports screens with coach gate, TeacherPage and pending-reports banner |
| `RubricGuide.tsx` | (unmapped) |
| `SendReport.test.tsx` | Pins Send report step: preview, To teacher, send once, retry and failure states |
| `SendReport.tsx` | Send report step 5 of 5: previews the bot-made report image then sends on WhatsApp |
| `SendReport.viewer.test.tsx` | (unmapped) |
| `SendReport.waMarks48.test.tsx` | (unmapped) |
| `V6Parts.tsx` | (unmapped) |
| `YourFeedback.test.tsx` | Pins Your feedback step: praise, wins, try-next, question or concern, dock behaviour |
| `YourFeedback.tsx` | Your feedback step 4 of 5: what the Digital Coach says about the coach's debrief |
| `copy.test.ts` | Pins Reports copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.5) |
| `copy.ts` | English and Urdu words for all coach Reports screens and the four observation steps |
| `data.test.ts` | Pins Reports arithmetic: Pakistan day grouping, spans, KPI numbers, load-more rule |
| `data.ts` | Reports list arithmetic from GET /api/portal/coach/reports rows: day groups, spans, KPIs |
| `evidenceReview.ts` | (unmapped) |
| `formKeep.ts` | (unmapped) |
| `formLevels.ts` | (unmapped) |
| `formModel.ts` | Feedback Form values and keys identical to the WhatsApp review form, with change counting |
| `indicatorGuide.tsx` | (unmapped) |
| `paths.ts` | Route paths of Reports and the observation's screens under /portal/coach/observation/:id |
| `routes.test.ts` | Pins that every Reports screen has a lazy route that gates itself through ReportsFrame |
| `saveTry.ts` | (unmapped) |
| `useAllReports.ts` | Pages through coach reports newest first, 30 per page, until the comparison period is covered |
| `useObservationView.ts` | Reads one observation from GET /leader/observe/:id, re-reading every 8 s while the worker owns the step |
| `v6Model.ts` | (unmapped) |
| `waText.tsx` | (unmapped) |

## Who reads this (all, generated)
- `CoachReportsAll.tsx` ← imported by `portal/src/App.tsx:145:a2685529`
- `Debrief.tsx` ← imported by `portal/src/App.tsx:147:d0a5d3f5` · `portal/src/portal/teacher/principal/routes.tsx:18:8d428bfb`
- `FeedbackForm.tsx` ← imported by `portal/src/App.tsx:146:c35841a3` · `portal/src/portal/teacher/principal/routes.tsx:17:750958e6`
- `FormV7.tsx` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:25:63a16334` · `portal/src/portal/coach/reports/FormV7List.tsx:18:faee4940` · `portal/src/portal/coach/reports/FormV7Nav.tsx:8:851c70ff` · `portal/src/portal/coach/reports/Obs612Form.tsx:23:faee4940`
- `FormV7List.tsx` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:26:4fa98467`
- `FormV7Nav.tsx` ← imported by `portal/src/portal/coach/reports/FormV7List.tsx:20:a6f31872` · `portal/src/portal/coach/reports/Obs612Form.tsx:24:a4da01b4`
- `InsightRow.tsx` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:24:a78567ff` · `portal/src/portal/coach/reports/RubricGuide.tsx:4:a78567ff` · `portal/src/portal/coach/reports/YourFeedback.tsx:9:a78567ff`
- `Obs612Form.tsx` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:22:08f0da49`
- `ReportImage.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:34:5d912bb9` · `portal/src/portal/coach/reports/SendReport.tsx:17:6ae3b98f`
- `ReportRows.tsx` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:14:340346ae` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:20:e585aa81` · `portal/src/portal/coach/pages/CoachReports.tsx:14:0a3b6206` · `portal/src/portal/teacher/principal/HomeV6.tsx:20:1750bf6e` (+4: `python3 kg/kg.py who-reads ReportRows.tsx`)
- `ReportsFrame.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:21:f774c913` · `portal/src/portal/coach/pages/CoachReports.tsx:13:f774c913` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:11:b1892bfc` · `portal/src/portal/coach/reports/Debrief.tsx:23:b1892bfc` (+5: `python3 kg/kg.py who-reads ReportsFrame.tsx`)
- `RubricGuide.tsx` ← imported by `portal/src/portal/pages/LeaderObserveTalk.tsx:18:f3209b16` · `portal/src/portal/coach/reports/Debrief.tsx:25:d5aad2f5`
- `SendReport.tsx` ← imported by `portal/src/App.tsx:149:1bb5f58e` · `portal/src/portal/teacher/principal/routes.tsx:22:1ea3eb4b`
- `V6Parts.tsx` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:20:d3f30783` · `portal/src/portal/coach/reports/FormV7.tsx:14:cecb5bd9` · `portal/src/portal/coach/reports/FormV7List.tsx:19:e364d27a`
- `YourFeedback.tsx` ← imported by `portal/src/App.tsx:148:459c7642` · `portal/src/portal/teacher/principal/routes.tsx:19:0d0e78e9`
- `copy.ts` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:13:8498d38a` · `portal/src/portal/coach/flow/VisitV7.tsx:15:8498d38a` · `portal/src/portal/coach/pages/CoachObservation.tsx:22:8498d38a` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:19:8498d38a` (+19: `python3 kg/kg.py who-reads copy.ts`)
- `data.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:23:338b8369` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:21:338b8369` · `portal/src/portal/coach/pages/CoachReports.tsx:17:e5be9041` · `portal/src/portal/teacher/principal/PrincipalObservations.tsx:22:35687b1b` (+3: `python3 kg/kg.py who-reads data.ts`)
- `evidenceReview.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:27:0ce37216` · `portal/src/portal/coach/reports/FormV7List.tsx:26:2209de02` · `portal/src/portal/coach/reports/Obs612Form.tsx:25:90561b45`
- `formKeep.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:15:07d4985f`
- `formLevels.ts` ← imported by `portal/src/portal/coach/reports/FormV7List.tsx:22:3bd72b61` · `portal/src/portal/coach/reports/Obs612Form.tsx:26:3bd72b61`
- `formModel.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:16:e7ff8a33` · `portal/src/portal/coach/reports/FormV7.tsx:13:8e423040` · `portal/src/portal/coach/reports/FormV7List.tsx:14:d2ede4bd` · `portal/src/portal/coach/reports/Obs612Form.tsx:13:3f46c817` (+2: `python3 kg/kg.py who-reads formModel.ts`)
- `indicatorGuide.tsx` ← imported by `portal/src/portal/teacher/help/observe/ObserveHelp.tsx:15:4f895334` · `portal/src/portal/coach/reports/FormV7.tsx:15:82be400a`
- `paths.ts` ← imported by `portal/src/portal/coach/observe/observeRoutes.tsx:5:6ff88a29` · `portal/src/portal/coach/pages/CoachObservation.tsx:24:80318d32` · `portal/src/portal/teacher/principal/observe.tsx:8:cdb0e197` · `portal/src/portal/coach/reports/Debrief.tsx:27:47a3432e` (+4: `python3 kg/kg.py who-reads paths.ts`)
- `saveTry.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:29:19761b71`
- `useAllReports.ts` ← imported by `portal/src/portal/coach/reports/CoachReportsAll.tsx:16:689afdb1`
- `useObservationView.ts` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:28:5676cf52` · `portal/src/portal/coach/reports/FeedbackForm.tsx:18:11810407` · `portal/src/portal/coach/reports/SendReport.tsx:20:5676cf52` · `portal/src/portal/coach/reports/YourFeedback.tsx:12:11810407`
- `v6Model.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:21:9e05b77a` · `portal/src/portal/coach/reports/FormV7List.tsx:21:c00092d7` · `portal/src/portal/coach/reports/V6Parts.tsx:10:8ac448bc` · `portal/src/portal/coach/reports/formModel.ts:2:b6decddb`
- `waText.tsx` ← imported by `portal/src/portal/coach/reports/SendReport.tsx:23:5eae88f1`

## Tests (all, generated)
- `CoachReportsAll.tsx` ← `portal/src/portal/coach/reports/CoachReportsAll.test.tsx`
- `Debrief.tsx` ← `portal/src/portal/coach/flow/v7errors.test.tsx` · `portal/src/portal/coach/reports/Debrief.stay39.test.tsx` · `portal/src/portal/coach/reports/Debrief.test.tsx`
- `FeedbackForm.tsx` ← `portal/src/portal/coach/reports/FeedbackForm.about37.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.autosave.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.checklist46.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.dc36.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.dcEvidence39.test.tsx` · `portal/src/portal/coach/reports/FeedbackForm.ffv7.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/coach/reports/FeedbackForm.tsx`)
- `FormV7.tsx` ← `portal/src/portal/coach/reports/FeedbackForm.about37.test.tsx` · `portal/src/portal/coach/reports/FormToast.clear48.test.tsx` · `portal/src/portal/coach/reports/FormToast.swipe40.test.tsx` · `portal/src/portal/coach/reports/FormV7.nextOneLine48.test.tsx` · `portal/src/portal/teacher/help/observe/ObserveHelp.test.tsx`
- `Obs612Form.tsx` ← `portal/src/portal/coach/reports/Obs612Form.test.tsx`?
- `ReportImage.tsx` ← `portal/src/portal/coach/reports/ReportImage.test.tsx`
- `ReportRows.tsx` ← `portal/src/portal/coach/flow/stopped245.test.tsx` · `portal/src/portal/coach/flow/v7visit39.test.tsx` · `portal/src/portal/coach/pages/CoachObservation.obs612.test.tsx` · `portal/src/portal/coach/pages/CoachObservation.steps4.test.tsx`
- `ReportsFrame.tsx` ← `portal/src/portal/coach/reports/ReportsFrame.dockSpace40.test.tsx` · `portal/src/portal/coach/uxMusts.test.tsx`
- `RubricGuide.tsx` ← `portal/src/portal/coach/report/LessonPlan.test.tsx`
- `SendReport.tsx` ← `portal/src/portal/coach/reports/SendReport.test.tsx` · `portal/src/portal/coach/reports/SendReport.viewer.test.tsx` · `portal/src/portal/coach/reports/SendReport.waMarks48.test.tsx` · `portal/src/portal/teacher/principal/PrincipalScores.test.tsx`
- `YourFeedback.tsx` ← `portal/src/portal/coach/reports/YourFeedback.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/flow/stopped245.test.tsx` · `portal/src/portal/coach/pages/CoachObservation.obs612.test.tsx` · `portal/src/portal/coach/reports/ReportImage.test.tsx` · `portal/src/portal/coach/reports/copy.test.ts` · `portal/src/portal/coach/uxMusts.test.tsx`
- `data.ts` ← `portal/src/portal/coach/reports/data.test.ts`
- `evidenceReview.ts` ← `portal/src/portal/coach/reports/FeedbackForm.evidence.test.ts`
- `indicatorGuide.tsx` ← `portal/src/portal/coach/reports/FeedbackForm.about37.test.tsx`
- `saveTry.ts` ← `portal/src/portal/coach/reports/FeedbackForm.saveLimit38.test.tsx`
- `waText.tsx` ← `portal/src/portal/coach/reports/SendReport.waMarks48.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
