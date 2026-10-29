# quiz — Tests for the quiz stack: authoring, validator, offers, class reports, web quiz
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/quiz kg=acedb0e8e762 gen=56019c429678 overflow=229 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `transcript-quiz-validator.test.js` — the deterministic validator all quizzes pass
- `lp-quiz-generate.test.js` — LP-born quiz generation (lp_v8)
- `transcript-quiz-generate.test.js` — author to hand-off
- Run from repo root: `node tests/run.js tests/quiz --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__fixtures__/` | → (no door; 1 files: 0 test + 1 support) |
| `fixtures/` | → (no door; 1 files: 0 test + 1 support) |
| `helpers/` | Shared stubs and fixtures for quiz suites: Supabase fakes, lesson fixtures → `helpers/CLAUDE.md` |
| `__snapshots__/` | → (not mapped: excluded; 1 files) |
| `transcript-quiz-typeset-maths.test.js` | Maths in a class quiz is typeset on cards via KaTeX and never reaches a phone as TeX source (bd-mg9c7.159.19 part A) |
| `transcript-quiz-summary-truth.test.js` | The teacher's sheet never presents a mistake made in class as what was taught: summary-truth check through generate |
| `lp-quiz-cache.test.js` | LP quiz cache: same lesson version reuses a donor quiz's questions with no digest/author/checks; no teacher data leaks |
| `quiz-daily-cap.test.js` | Runaway guard: at most QUIZ_DAILY_CAP quizzes per teacher per PKT day, counted before any model call, in Redis |
| `web*` | 6 files; most used `web-quiz-items-generate.test.js`: SCHEMA_v2 web items at generation: media.web stored only on the web arm with web_quiz_items_v2 on; else unchanged |
| … | 258 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Wiring tests must execute the changed line, not grep it (tests/quiz/transcript-quiz-router.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/monitoring/CLAUDE.md`? · `bot/shared/services/nudges/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.md`? · `bot/shared/services/quiz/providers/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`? (+7)
