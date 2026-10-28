# scoring — AI scoring of one recorded block: transcript, windows, scorers, ai_marks
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/scoring kg=334fcb1a86d3 gen=a3fb82af85a5 overflow=73 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — scoreBlock/scoreTask, writes ai_marks once
- `prompts.js` — model prompts; STORY is the study prompt verbatim
- `thresholds.js` — per-field confidence bars the check Flow pre-fills by
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `tasks/` | Per-task v3 scorers (letters, words, story, listening, maths) on shared engines → `tasks/CLAUDE.md` |
| `text-norm.js` | Word normalisation, one-edit same-word rule and alignment ported from the May 2026 study harness |
| `llm.js` | One JSON-returning model call through llm-client (OpenRouter) that never throws; reports cost and latency |
| `windows.js` | Cuts a block's voice note into sections using Soniox words, cue phrases and the items themselves |
| … | 18 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `models.js` ← imported by `bot/shared/services/child-test/sa/score.js:347:1df8788a` · `bot/shared/services/child-test/scoring/child-no.js:17:46763490` (+10)
- `llm.js` ← imported by `bot/shared/services/child-test/sa/score.js:346:a4319e29` · `bot/shared/services/child-test/scoring/child-no.js:18:0aeeb15e` (+9)
- `text-norm.js` ← imported by `bot/scripts/quiz/one-voice-missing-keys.js:82:3b9dd554` · `bot/shared/services/child-test/sa/last-word-hint.js:15:81b9c396` (+9)
- … 20 more → `CLAUDE.index.md`

## Never (human)
- Do not edit the STORY prompt: a changed word invalidates the measurement (prompts.js:7)
- scoreBlock never throws into the conversation (index.js:8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-score-timeouts.test.js` (llm.js, media.js, stt.js)
- `tests/child-test/L11/scorer-quick-sums.test.js` (labeller.js, text-norm.js, windows.js)
- … 35 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.md`? (+1)
