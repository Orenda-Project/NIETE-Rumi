# quiz — Quiz and Challenge audio, language and kept-reading maintenance scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/quiz kg=1c6e2ef7666c gen=20c3016c78e6 overflow=14 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `backfill-bank-quiz-audio.js` — pre-record library quiz clips
- `purge-kept-child-voice.js` — delete kept readings by day
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `backfill-bank-quiz-audio.js` | Pre-records read-aloud clips for video-bank quizzes so a child's first open is not delayed; guarded by --expect-ref |
| `record-one-voice-shared-lines.js` | Records the shared Jugnu voice lines in one voice plan of web_quiz_one_voice into the dashboard wq/voice set folder |
| `backfill-quiz-language.js` | Marks each video-bank quiz with the language its questions are written in (quizzes.language); dry run default |
| `purge-kept-child-voice.js` | Deletes the Challenge's kept child readings from the private child-voice bucket; dry run default, --apply deletes |
| `restore-bank-recorded-voices.js` | Restores human-recorded option audio to video-bank quiz questions from a map file after an import dropped it |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:224:2c6afb51`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:273:baba8374`? (+60)
- column `quizzes.meta` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` (+24)
- table `quiz_questions` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:89:ec1258c5`? · `bot/shared/services/quiz/lp-quiz-cache.js:155:2421430e`? (+14)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- purge-kept-child-voice.js is dry run by default; --apply deletes (purge-kept-child-voice.js:8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/first-touch/maker.qlang.test.js` (backfill-quiz-language.js)
- `bot/tests/quiz/backfill-bank-quiz-audio.test.js` (backfill-bank-quiz-audio.js)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
