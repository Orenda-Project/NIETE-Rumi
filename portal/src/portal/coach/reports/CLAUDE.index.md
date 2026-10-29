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
| `FeedbackForm.test.tsx` | Pins Feedback Form: step bar, plan moves, rating scale, change counting, read-only after send |
| `FeedbackForm.tsx` | Feedback Form step 2 of 5: WhatsApp review form in the portal, saving r_/ev_/imp_/fid_ keys |
| `InsightRow.tsx` | One toned labelled line used by Debrief guide, feedback and report preview |
| `ReportRows.tsx` | Reports list rows and cards on kit HistoryRow, with chips and segments |
| `ReportsFrame.tsx` | Shared frame of Reports screens with coach gate, TeacherPage and pending-reports banner |
| `SendReport.test.tsx` | Pins Send report step: preview, To teacher, send once, retry and failure states |
| `SendReport.tsx` | Send report step 5 of 5: previews the bot-made report image then sends on WhatsApp |
| `YourFeedback.test.tsx` | Pins Your feedback step: praise, wins, try-next, question or concern, dock behaviour |
| `YourFeedback.tsx` | Your feedback step 4 of 5: what the Digital Coach says about the coach's debrief |
| `copy.test.ts` | Pins Reports copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.5) |
| `copy.ts` | English and Urdu words for all coach Reports screens and the four observation steps |
| `data.test.ts` | Pins Reports arithmetic: Pakistan day grouping, spans, KPI numbers, load-more rule |
| `data.ts` | Reports list arithmetic from GET /api/portal/coach/reports rows: day groups, spans, KPIs |
| `formModel.ts` | Feedback Form values and keys identical to the WhatsApp review form, with change counting |
| `paths.ts` | Route paths of Reports and the observation's screens under /portal/coach/observation/:id |
| `routes.test.ts` | Pins that every Reports screen has a lazy route that gates itself through ReportsFrame |
| `useAllReports.ts` | Pages through coach reports newest first, 30 per page, until the comparison period is covered |
| `useObservationView.ts` | Reads one observation from GET /leader/observe/:id, re-reading every 8 s while the worker owns the step |

## Who reads this (all, generated)
- `CoachReportsAll.tsx` ← imported by `portal/src/App.tsx:135:a2685529`
- `Debrief.tsx` ← imported by `portal/src/App.tsx:137:d0a5d3f5`
- `FeedbackForm.tsx` ← imported by `portal/src/App.tsx:136:c35841a3`
- `InsightRow.tsx` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:21:a78567ff` · `portal/src/portal/coach/reports/YourFeedback.tsx:8:a78567ff`
- `ReportRows.tsx` ← imported by `portal/src/portal/coach/pages/CoachReports.tsx:14:9602a3b5` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:12:e49240d7`
- `ReportsFrame.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:17:f774c913` · `portal/src/portal/coach/pages/CoachReports.tsx:13:f774c913` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:11:b1892bfc` · `portal/src/portal/coach/reports/Debrief.tsx:20:b1892bfc` (+3: `python3 kg/kg.py who-reads ReportsFrame.tsx`)
- `SendReport.tsx` ← imported by `portal/src/App.tsx:139:1bb5f58e`
- `YourFeedback.tsx` ← imported by `portal/src/App.tsx:138:459c7642`
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:18:8498d38a` · `portal/src/portal/coach/pages/CoachReports.tsx:15:8498d38a` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:13:43167662` · `portal/src/portal/coach/reports/Debrief.tsx:22:43167662` (+5: `python3 kg/kg.py who-reads copy.ts`)
- `data.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:19:338b8369` · `portal/src/portal/coach/pages/CoachReports.tsx:16:e5be9041` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:14:4c69f773` · `portal/src/portal/coach/reports/ReportRows.tsx:6:e6591fbe` (+1: `python3 kg/kg.py who-reads data.ts`)
- `formModel.ts` ← imported by `portal/src/portal/coach/reports/FeedbackForm.tsx:13:c14b8079`
- `paths.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:20:fd113ca3` · `portal/src/portal/coach/reports/Debrief.tsx:23:6ec6c9e4` · `portal/src/portal/coach/reports/FeedbackForm.tsx:14:6ec6c9e4` · `portal/src/portal/coach/reports/SendReport.tsx:17:6ec6c9e4` (+1: `python3 kg/kg.py who-reads paths.ts`)
- `useAllReports.ts` ← imported by `portal/src/portal/coach/reports/CoachReportsAll.tsx:15:689afdb1`
- `useObservationView.ts` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:24:5676cf52` · `portal/src/portal/coach/reports/FeedbackForm.tsx:15:11810407` · `portal/src/portal/coach/reports/SendReport.tsx:18:5676cf52` · `portal/src/portal/coach/reports/YourFeedback.tsx:11:11810407`

## Tests (all, generated)
- `CoachReportsAll.tsx` ← `portal/src/portal/coach/reports/CoachReportsAll.test.tsx`
- `Debrief.tsx` ← `portal/src/portal/coach/reports/Debrief.test.tsx`
- `FeedbackForm.tsx` ← `portal/src/portal/coach/reports/FeedbackForm.test.tsx`
- `SendReport.tsx` ← `portal/src/portal/coach/reports/SendReport.test.tsx`
- `YourFeedback.tsx` ← `portal/src/portal/coach/reports/YourFeedback.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/reports/copy.test.ts`
- `data.ts` ← `portal/src/portal/coach/reports/data.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
