# assess — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/lib/assess -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `blocks.test.ts` | Pins blocks.ts: five ordered blocks, start block moves per Pakistan day, pickBlock skips used blocks, "full" option |
| `blocks.ts` | Learning assessment: which battery block (B1..B5, full, RDF variants) a child takes; rotates by Pakistan day |
| `cohortStats.test.ts` | Pins exampleCohort (seeded 1,000 synthetic students) and cohortStats/rwpNorms numbers shown on the dashboard |
| `cohortStats.ts` | Results-dashboard maths: ORF/comprehension/maths benchmark bands and filtering, computed from SaTaskResult shape |
| `copy.test.ts` | Pins assess/copy.ts: en/ur carry same keys, Urdu is Urdu script, no gendered wording, no roll numbers |
| `copy.ts` | All coach-facing Urdu/English strings for the Learning assessment page, plus Urdu-digit and bidi helpers |
| `cwpm.ts` | Round 7b sa_cwpm: isWordsTask picks the tasks whose rate is labelled CWPM (words/story, not comprehension) |
| `dashboardCopy.ts` | Urdu/English strings for the results dashboard (example and live), plus the CWPM label overrides |
| `exampleCohort.ts` | Seeded generator of 1,000 synthetic students for the sandbox-only example results dashboard (sa_example_dashboard) |
| `micReport.ts` | (unmapped) |
| `outbox.ts` | Sends one offline-queued assessment outcome via childTestSa and classifies it sent, retry or refused by HTTP status |
| `qr.test.ts` | Pins qr.ts: qrMatrix equals independent reference encoder output for v2, v8 and v14 symbols; qrSvgPath |
| `qr.ts` | Dependency-free QR encoder (byte mode, level M, v1-20) so one phone can show a link for another to scan |
| `realCohort.test.ts` | Pins realCohort.ts: sessions to dashboard students, NO_SECTOR fallback, grade 1-5 filter, <5 masking |
| `realCohort.ts` | Maps live dashboard sessions to DashStudent rows (sa_real_dashboard) and masks groups under 5 children as <5 |
| `results.ts` | resultsPath: builds the /portal/leader/assess/results/:sessionId URL, carrying the session id only |
| `reviewCopy.ts` | Urdu/English strings for the coach's visit-review page (per-child recordings, ear-mark scoring) |
| `rwpNorms.ts` | Reference oral-reading-fluency norms per grade 1-5 and language from the Rawalpindi EGRA study, for the dashboard |
| `switches.ts` | useSaSwitches: reads the coach's assessment feature switches once via childTestSa, fail-closed to all off |
| `urFit.css` | sa_ur_fit stylesheet: Urdu line-height, small-print size and side padding so Urdu words fit on 320-390px phones |
| `urFit.test.tsx` | Pins useUrFit: sa-ur-fit class on <html> only while open and switch on; off when absent or unreadable |
| `urFit.ts` | useUrFit: marks <html> with sa-ur-fit while an assessment page is open when the childTestSa switch answers true |
| `visitStore.ts` | localStorage memory of one assessment visit (per school and PKT day): queued outcomes, mic check, children done |

## Who reads this (all, generated)
- `blocks.ts` ← imported by `portal/src/portal/components/assess/AssessEngineSlot.tsx:3:91b77f58` · `portal/src/portal/components/assess/AssessOtherPhone.tsx:5:91b77f58` · `portal/src/portal/pages/LeaderAssess.tsx:20:94084425` · `portal/src/portal/lib/assess/visitStore.ts:2:1aabb554`
- `cohortStats.ts` ← imported by `portal/src/portal/pages/LeaderAssessDashboard.tsx:12:030b09f5`
- `copy.ts` ← imported by `portal/src/portal/components/assess/AssessEngineSlot.tsx:2:c94dcd90` · `portal/src/portal/components/assess/AssessOtherPhone.tsx:4:71d3bb00` · `portal/src/portal/components/assess/AssessPreflight.tsx:3:795cbfc9` · `portal/src/portal/components/assess/AssessVisitBar.tsx:2:795cbfc9` (+6: `python3 kg/kg.py who-reads copy.ts`)
- `cwpm.ts` ← imported by `portal/src/portal/pages/LeaderAssessResults.tsx:7:29b236b2` · `portal/src/portal/pages/LeaderAssessReview.tsx:8:29b236b2`
- `dashboardCopy.ts` ← imported by `portal/src/portal/pages/LeaderAssessDashboard.tsx:8:cf3118e2` · `portal/src/portal/pages/LeaderAssessReview.tsx:9:a19bb069`
- `exampleCohort.ts` ← imported by `portal/src/portal/pages/LeaderAssessDashboard.tsx:9:8bc0d051` · `portal/src/portal/lib/assess/cohortStats.ts:2:53f0d4b3` · `portal/src/portal/lib/assess/realCohort.ts:2:82ac6238` · `portal/src/portal/lib/assess/rwpNorms.ts:1:72baf5a4`
- `micReport.ts` ← imported by `portal/src/portal/components/assess/AssessPreflight.tsx:6:0750d41a`
- `outbox.ts` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:23:b9eae346`
- `qr.ts` ← imported by `portal/src/portal/components/assess/AssessOtherPhone.tsx:6:9ee877b5`
- `realCohort.ts` ← imported by `portal/src/portal/pages/LeaderAssessDashboard.tsx:10:9f60aacf` · `portal/src/portal/lib/assess/cohortStats.ts:3:72369a27`
- `results.ts` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:22:e5a7aa9f`
- `reviewCopy.ts` ← imported by `portal/src/portal/pages/LeaderAssessReview.tsx:10:588c75ea`
- `rwpNorms.ts` ← imported by `portal/src/portal/pages/LeaderAssessDashboard.tsx:13:e1c9ad79`
- `switches.ts` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:21:bcbb90a8`
- `urFit.css` ← imported by `portal/src/portal/lib/assess/urFit.ts:3:cfcafb1d`
- `urFit.ts` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:19:648fc8d6` · `portal/src/portal/pages/LeaderAssessDashboard.tsx:7:648fc8d6` · `portal/src/portal/pages/LeaderAssessResults.tsx:8:648fc8d6` · `portal/src/portal/pages/LeaderAssessReview.tsx:7:648fc8d6`
- `visitStore.ts` ← imported by `portal/src/portal/components/assess/AssessOfflineCard.tsx:4:e86a76f0` · `portal/src/portal/components/assess/AssessPreflight.tsx:4:38086f51` · `portal/src/portal/components/assess/AssessVisitBar.tsx:3:acc2c250` · `portal/src/portal/components/assess/offlineReady.ts:3:7c1ffb32` (+2: `python3 kg/kg.py who-reads visitStore.ts`)

## Tests (all, generated)
- `blocks.ts` ← `portal/src/portal/lib/assess/blocks.test.ts` · `portal/src/portal/pages/LeaderAssess.test.tsx`
- `cohortStats.ts` ← `portal/src/portal/lib/assess/cohortStats.test.ts` · `portal/src/portal/lib/assess/realCohort.test.ts`
- `copy.ts` ← `portal/src/portal/components/assess/AssessPreflight.ios.test.tsx` · `portal/src/portal/components/assess/AssessPreflight.test.tsx` · `portal/src/portal/lib/assess/copy.test.ts`
- `exampleCohort.ts` ← `portal/src/portal/lib/assess/cohortStats.test.ts`
- `qr.ts` ← `portal/src/portal/lib/assess/qr.test.ts`
- `realCohort.ts` ← `portal/src/portal/lib/assess/realCohort.test.ts`
- `results.ts` ← `portal/src/portal/pages/LeaderAssessResults.test.tsx`
- `rwpNorms.ts` ← `portal/src/portal/lib/assess/cohortStats.test.ts`
- `urFit.ts` ← `portal/src/portal/lib/assess/urFit.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/lib/CLAUDE.md`? · `portal/src/portal/types/CLAUDE.md`?
