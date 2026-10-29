# reports — Coach Reports lists and the four observation steps (form, debrief, feedback, send)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/reports kg=3773612085ae gen=ed0a2026f5bc overflow=32 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `data.ts` | Reports list arithmetic from GET /api/portal/coach/reports rows: day groups, spans, KPIs |
| `copy.test.ts` | Pins Reports copy: Urdu complete, label-only values, locked vocabulary (bd-4404s7.5) |
| `paths.ts` | Route paths of Reports and the observation's screens under /portal/coach/observation/:id |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:18:8498d38a` · `portal/src/portal/coach/pages/CoachReports.tsx:15:8498d38a` (+7)
- `ReportsFrame.tsx` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:17:f774c913` · `portal/src/portal/coach/pages/CoachReports.tsx:13:f774c913` (+5)
- `data.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:19:338b8369` · `portal/src/portal/coach/pages/CoachReports.tsx:16:e5be9041` (+3)
- `paths.ts` ← imported by `portal/src/portal/coach/pages/CoachObservation.tsx:20:fd113ca3` · `portal/src/portal/coach/reports/Debrief.tsx:23:6ec6c9e4` (+3)
- … 10 more → `CLAUDE.index.md`

## Never (human)
- Form keys must equal the WhatsApp review form's keys (reports/formModel.ts:4)
- Nothing is sent to a teacher until the coach taps Send (reports/SendReport.tsx:25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/reports/CoachReportsAll.test.tsx` (CoachReportsAll.tsx)
- `portal/src/portal/coach/reports/Debrief.test.tsx` (Debrief.tsx)
- … 5 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
