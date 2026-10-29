# __testing__ — Test helper for driving the one-question module quiz

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/__testing__ kg=24fbb637217e gen=c0e3d6f3070e overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `oneQuestionQuiz.ts` — mockOneQuestionQuiz/takeOneQuestionQuiz used by ModuleQuizPanel tests (bd-klecr.6)
- Not a test file (vitest runs only *.test.ts(x)); run its users with `cd portal && npx vitest run src/portal/components` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `oneQuestionQuiz.ts` | bd-klecr.6 test helper: drives ModuleQuizPanel one-question flow (pick, Check, Submit) with a mocked POST |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/ModuleQuizPanel.test.tsx` (oneQuestionQuiz.ts)
- `portal/src/portal/pages/PortalTrainingV2.numericIds.test.tsx` (oneQuestionQuiz.ts)
- `portal/src/portal/pages/PortalTrainingV2.quizTick.test.tsx` (oneQuestionQuiz.ts)

## Related (generated)
- docs: `portal/src/portal/components/CLAUDE.md`?
