# types — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/types -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `childTest.ts` | Types of the coach-app child test mirroring the bot's app-api.service (bd-s1oo0.7) |
| `childTestSa.parse.test.ts` | Parse check that childTestSa.ts compiles, as type-only files are never bundled |
| `childTestSa.ts` | Types of the coach's Learning assessment (SA engine) served under /api/portal/leader/child-test/sa |
| `portal.ts` | Shared portal types: User, dashboard stats, lesson plans, coaching sessions, analysis |
| `readingAssessment.ts` | Types of reading assessment API answers (ReadingAssessment, Detail, Stats) |

## Who reads this (all, generated)
- `childTest.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:3:80210b47` · `portal/src/portal/components/childTest/CheckForm.tsx:3:067da7be` · `portal/src/portal/components/childTest/StimulusCard.tsx:1:10d3115f` · `portal/src/portal/lib/childTest/checkDraft.ts:13:b3550e6b` (+2: `python3 kg/kg.py who-reads childTest.ts`)
- `childTestSa.ts` ← imported by `portal/src/portal/components/assess/AssessOfflineCard.tsx:5:cfeccff9` · `portal/src/portal/components/assess/offlineReady.ts:4:dc0245f2` · `portal/src/portal/lib/assess/cohortStats.ts:1:37372d88` · `portal/src/portal/lib/assess/exampleCohort.ts:1:871733d4` (+9: `python3 kg/kg.py who-reads childTestSa.ts`)
- `portal.ts` ← imported by `portal/src/portal/analytics/BandToggle.tsx:2:9e2fef83` · `portal/src/portal/analytics/Filters.tsx:5:1b25621f` · `portal/src/portal/analytics/Numbers.tsx:2:3b502e49` · `portal/src/portal/analytics/SchoolsAnalytics.tsx:10:1d8e5709` (+57: `python3 kg/kg.py who-reads portal.ts`)
- `readingAssessment.ts` ← imported by `portal/src/portal/services/api.ts:9:8f1c6e95` · `portal/src/portal/pages/PortalReadingAssessmentDetail.tsx:6:7a1053dd` · `portal/src/portal/pages/PortalReadingAssessments.tsx:6:cbc98559`

## Tests (all, generated)
- `childTest.ts` ← `portal/src/portal/components/childTest/BlockRecorder.test.tsx` · `portal/src/portal/lib/childTest/checkDraft.test.ts`
- `childTestSa.ts` ← `portal/src/portal/lib/assess/realCohort.test.ts`
- `portal.ts` ← `portal/src/portal/teacher/analytics/model.test.ts` · `portal/src/portal/teacher/classes/model.test.ts`

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/components/childTest/CLAUDE.md`? · `portal/src/portal/lib/assess/CLAUDE.index.md`? · `portal/src/portal/lib/assess/CLAUDE.md`? · `portal/src/portal/lib/childTest/CLAUDE.index.md`? · `portal/src/portal/lib/childTest/CLAUDE.md`? · `portal/src/portal/teacher/analytics/CLAUDE.index.md`? · `portal/src/portal/teacher/classes/CLAUDE.index.md`? · `portal/src/portal/types/CLAUDE.index.md`? · `portal/src/portal/types/CLAUDE.md`?
