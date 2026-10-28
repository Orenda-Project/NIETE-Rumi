# types — Shared TypeScript shapes of portal API answers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/types kg=4c97cc080cb0 gen=2dd03de51acd overflow=4 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal.ts` — User, dashboard and coaching types used across the portal
- `childTestSa.ts` — coach Learning assessment shapes; its parse test is the only test
- Run `cd portal && npx vitest run src/portal/types`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `portal.ts` | Shared portal types: User, dashboard stats, lesson plans, coaching sessions, analysis |
| `childTestSa.ts` | Types of the coach's Learning assessment (SA engine) served under /api/portal/leader/child-test/sa |
| `childTest.ts` | Types of the coach-app child test mirroring the bot's app-api.service (bd-s1oo0.7) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `readingAssessment.ts` | Types of reading assessment API answers (ReadingAssessment, Detail, Stats) |
| `childTestSa.parse.test.ts` | Parse check that childTestSa.ts compiles, as type-only files are never bundled |

## Who reads this (generated)
- `portal.ts` ← imported by `portal/src/portal/analytics/BandToggle.tsx:2:9e2fef83` · `portal/src/portal/analytics/Filters.tsx:5:1b25621f` (+59)
- `childTestSa.ts` ← imported by `portal/src/portal/components/assess/AssessOfflineCard.tsx:5:cfeccff9` · `portal/src/portal/components/assess/offlineReady.ts:4:dc0245f2` (+11)
- `childTest.ts` ← imported by `portal/src/portal/components/childTest/BlockRecorder.tsx:3:80210b47` · `portal/src/portal/components/childTest/CheckForm.tsx:3:067da7be` (+4)
- … 1 more → `CLAUDE.index.md`

## Never (human)
- Types mirror what the server returns and add no defaults (childTestSa.ts:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/childTest/BlockRecorder.test.tsx` (childTest.ts)
- `portal/src/portal/lib/assess/realCohort.test.ts` (childTestSa.ts)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/components/childTest/CLAUDE.md`? · `portal/src/portal/lib/assess/CLAUDE.index.md`? · `portal/src/portal/lib/assess/CLAUDE.md`? · `portal/src/portal/lib/childTest/CLAUDE.index.md`? · `portal/src/portal/lib/childTest/CLAUDE.md`? (+4)
