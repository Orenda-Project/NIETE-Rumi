# quiz — Tests for the quiz stack: authoring, validator, offers, class reports, web quiz
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/quiz kg=542477d411bb gen=defaa461e790 overflow=233 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `transcript-quiz-validator.test.js` — the deterministic validator all quizzes pass
- `lp-quiz-generate.test.js` — LP-born quiz generation (lp_v8)
- `transcript-quiz-generate.test.js` — author to hand-off
- Run from repo root: `node tests/run.js tests/quiz --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__fixtures__/` | Golden recorded sends of the LP quiz offer → `__fixtures__/CLAUDE.md` |
| `fixtures/` | → (no door; 1 test files) |
| `helpers/` | Shared stubs and fixtures for quiz suites: Supabase fakes, lesson fixtures → `helpers/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `transcript-quiz-typeset-maths.test.js` | Maths in a class quiz is typeset on cards via KaTeX and never reaches a phone as TeX source (bd-mg9c7.159.19 part A) |
| `transcript-quiz-summary-truth.test.js` | The teacher's sheet never presents a mistake made in class as what was taught: summary-truth check through generate |
| … | 233 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quiz_sessions` (written by `quiz-attempts-kept.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:144:a4d322ab`? · `bot/shared/handlers/text-message.handler.js:258:e211522c`? (+46)
- column `quiz_sessions.status` (written by `quiz-attempts-kept.test.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:322:14a4b92a` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:304:66e5988e` (+26)
- env read here: `INTERNAL_API_KEY` · `OPENAI_API_KEY` · `PORTAL_URL` · `QUIZ_URDU_SPACING_V2` · `WEB_QUIZ_AUDIO_BUCKET` · `WEB_QUIZ_BASE_URL` · `WORKER_QUEUES`

## Never (human)
- Wiring tests must execute the changed line, not grep it (tests/quiz/transcript-quiz-router.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/setup/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/monitoring/CLAUDE.md`? (+31)
