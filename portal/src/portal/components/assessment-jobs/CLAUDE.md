# assessment-jobs — Page-level tracking of exam papers being generated

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/assessment-jobs kg=3917fcffa8db gen=6246b490d156 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `usePaperJobs.ts` — polls each requested paper job; kept per user in sessionStorage
- `BeingMade.tsx` — top of My papers: in-flight and failed papers; tests: `cd portal && npx vitest run src/portal/components/assessment-jobs` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `usePaperJobs.ts` | bd-t5tow: page-level hook tracking every requested paper job with polling; kept per user in sessionStorage |
| `failureMessages.ts` | Maps paper-generation failure codes to plain page copy naming what the teacher can change, with a fallback |
| `usePaperJobs.test.ts` | bd-t5tow: usePaperJobs polls 4 s then 30 s slow, never gives up, survives refresh via sessionStorage |
| `BeingMade.tsx` | bd-t5tow: top of My papers listing papers still being made or just failed, with failure reason |

## Who reads this (generated)
- `failureMessages.ts` ← imported by `portal/src/portal/components/AssessmentGeneratorPanel.tsx:67:5e5bf6e9` · `portal/src/portal/pages/ClassicAssessment.tsx:27:22cdac60` (+3)
- `usePaperJobs.ts` ← imported by `portal/src/portal/components/AssessmentGeneratorPanel.tsx:68:7e891a71` · `portal/src/portal/pages/ClassicAssessment.tsx:28:a4c93d80` (+2)
- `BeingMade.tsx` ← imported by `portal/src/portal/pages/ClassicAssessment.tsx:26:5f141f8e`

## Never (human)
- Polling never gives up (4 s, then 30 s slow); the old 5-minute give-up is gone (usePaperJobs.test.ts:6, bd-t5tow)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/assessment-jobs/usePaperJobs.test.ts` (usePaperJobs.ts)
- `portal/src/portal/pages/ClassicAssessment.tabs.test.tsx` (usePaperJobs.ts)

## Related (generated)
- (none)
