# tasks — Per-task v3 scorers (letters, words, story, listening, maths) on shared engines
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/scoring/tasks kg=b8c5820cb0d8 gen=762b0c84144e overflow=16 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — dispatches a v3 task to its scorer
- `common.js` — clock, stop rules, fluency rate, ai-marks-v3 shape
- `prompts.js` — R8-measured per-task prompts
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `common.js` | Shared v3 task-scorer pieces: clock, EGRA/EGMA stop rules, fluency rate, review rules, ai-marks-v3 shape (bd-s1oo0.50.3) |
| `CLAUDE.index.md` | (unmapped) |
| `prompts.js` | Per-task v3 prompts ported word for word from the R8 measurement lane, filled with bank item lists |
| `engine.js` | The timed and untimed v3 task engines (clip cut, audio-model call, per-item rows, stop rule) used by task scorers |
| `CLAUDE.md` | (unmapped) |
| `index.js` | Dispatches a v3 task to its per-kind scorer and returns ai-marks-v3 |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `common.js` ← imported by `bot/shared/services/quiz/web-quiz-challenge.js:111:2d87cd99` · `bot/shared/services/child-test/scoring/tasks/engine.js:15:ed7752a5` (+3)
- `prompts.js` ← imported by `bot/shared/services/child-test/sa/score.js:301:c39e83bd` · `bot/shared/services/child-test/scoring/tasks/fluency.js:8:8194ea63` (+3)
- `engine.js` ← imported by `bot/shared/services/child-test/scoring/tasks/fluency.js:9:db60f2eb` · `bot/shared/services/child-test/scoring/tasks/letters.js:12:db60f2eb` (+2)
- … 7 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L37/score-task.test.js` (common.js)
- `tests/child-test/L40/e2e-scoring-fixes.test.js` (common.js)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.md`? · `tests/child-test/L37/CLAUDE.md`? · `tests/child-test/L40/CLAUDE.md`? (+2)
