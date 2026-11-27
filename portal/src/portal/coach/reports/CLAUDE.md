# reports — Coach Reports lists and the four observation steps (form, debrief, feedback, send)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/reports kg=11b5b185f270 gen=026118c558ca overflow=124 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `FeedbackForm.tsx` — step 2; `Debrief.tsx` 3; `YourFeedback.tsx` 4; `SendReport.tsx` 5
- `data.ts` — Pakistan-day grouping and KPI maths for the lists
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/reports`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__snapshots__/` | → (not mapped: excluded; 1 files) |
| `copy.ts` | English and Urdu words for all coach Reports screens and the four observation steps |
| `FeedbackForm.tsx` | Feedback Form step 2 of 5: WhatsApp review form in the portal, saving r_/ev_/imp_/fid_ keys |
| `ReportRows.tsx` | Reports list rows and cards on kit HistoryRow, with chips and segments |
| `data.ts` | Reports list arithmetic from GET /api/portal/coach/reports rows: day groups, spans, KPIs |
| … | 63 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:13:8498d38a` · `portal/src/portal/coach/flow/VisitV7.tsx:15:8498d38a` (+21)
- `data.ts` ← imported by `portal/src/portal/coach/observe/KeptRows.tsx:13:338b8369` · `portal/src/portal/coach/pages/CoachObservation.tsx:24:338b8369` (+9)
- `ReportsFrame.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:22:f774c913` · `portal/src/portal/coach/pages/CoachReports.tsx:13:f774c913` (+7)
- `ReportRows.tsx` ← imported by `portal/src/portal/coach/flow/FocusCard.tsx:14:340346ae` · `portal/src/portal/coach/pages/CoachObserveToday.tsx:20:e585aa81` (+6)
- … 25 more → `CLAUDE.index.md`

## Never (human)
- Form keys must equal the WhatsApp review form's keys (reports/formModel.ts:4)
- Nothing is sent to a teacher until the coach taps Send (reports/SendReport.tsx:25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/reports/FeedbackForm.about37.test.tsx` (FeedbackForm.tsx, FormV7.tsx, indicatorGuide.tsx)
- `portal/src/portal/coach/flow/stopped245.test.tsx` (ReportRows.tsx, copy.ts)
- … 48 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
