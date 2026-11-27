# quiz — Quiz and Challenge audio, language and kept-reading maintenance scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/quiz kg=8167b7eff024 gen=622997c8d952 overflow=16 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `backfill-bank-quiz-audio.js` — pre-record library quiz clips
- `purge-kept-child-voice.js` — delete kept readings by day
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `backfill*` | 3 files; most used `backfill-bank-quiz-audio.js`: Pre-records read-aloud clips for video-bank quizzes so a child's first open is not delayed; guarded by --expect-ref |
| `record-one-voice-shared-lines.js` | Records the shared Jugnu voice lines in one voice plan of web_quiz_one_voice into the dashboard wq/voice set folder |
| `gb-quiz-readiness.js` | (unmapped) |
| `one-voice-missing-keys.js` | Pre-flip check that every voice line served under a web_quiz_one_voice plan is already stored in that voice |
| `purge-kept-child-voice.js` | Deletes the Challenge's kept child readings from the private child-voice bucket; dry run default, --apply deletes |
| `restore-bank-recorded-voices.js` | Restores human-recorded option audio to video-bank quiz questions from a map file after an import dropped it |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `restore-bank-recorded-voices.js`) ← read by `bot/scripts/quiz-teacher-edit-revert.js:72:2bad8432`? · `bot/shared/routes/quiz-flow-endpoint.js:229:2c6afb51`? (+74)
- column `quizzes.meta` (written by `restore-bank-recorded-voices.js`) ← read by `bot/scripts/quiz-teacher-edit-revert.js:72:2bad8432` · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9` (+37)
- table `quiz_questions` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:89:ec1258c5`? · `bot/shared/services/quiz/lp-quiz-cache.js:163:2421430e`? (+21)
- … 7 more → `CLAUDE.index.md`

## Never (human)
- purge-kept-child-voice.js is dry run by default; --apply deletes (purge-kept-child-voice.js:8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/first-touch/maker.qlang.test.js` (backfill-quiz-language.js)
- `bot/tests/quiz/backfill-bank-quiz-audio.test.js` (backfill-bank-quiz-audio.js)
- … 9 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
