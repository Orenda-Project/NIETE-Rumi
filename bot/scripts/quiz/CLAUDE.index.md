# quiz — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/quiz -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `backfill-bank-quiz-audio.js` | Pre-records read-aloud clips for video-bank quizzes so a child's first open is not delayed; guarded by --expect-ref |
| `backfill-quiz-language.js` | Marks each video-bank quiz with the language its questions are written in (quizzes.language); dry run default |
| `one-voice-missing-keys.js` | Pre-flip check that every voice line served under a web_quiz_one_voice plan is already stored in that voice |
| `purge-kept-child-voice.js` | Deletes the Challenge's kept child readings from the private child-voice bucket; dry run default, --apply deletes |
| `record-one-voice-shared-lines.js` | Records the shared Jugnu voice lines in one voice plan of web_quiz_one_voice into the dashboard wq/voice set folder |
| `record-welcome-lines.js` | Records the Jugnu welcome lines in the one-voice plan's voice into their own folder, leaving shared-line hashes alone |
| `rescore-kept-reads.js` | Re-scores kept Challenge readings scored before the noise floor so each carries quality, flags and alignment marks |
| `restore-bank-recorded-voices.js` | Restores human-recorded option audio to video-bank quiz questions from a map file after an import dropped it |

## Who reads this (all, generated)
- `backfill-bank-quiz-audio.js` ← imported by `bot/scripts/quiz/one-voice-missing-keys.js:41:1125ee45` · `bot/scripts/quiz/restore-bank-recorded-voices.js:28:1125ee45`
- `record-one-voice-shared-lines.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:98:e2c4d2f1` · `bot/scripts/quiz/record-welcome-lines.js:19:e7c0dcd5`
- column `quiz_questions.media` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/services/quiz/transcript-quiz-generate.service.js:3231:c87e9b89` · `bot/shared/services/quiz/web-quiz-publish.service.js:383:0da6bf9d` · `bot/shared/services/quiz/web-quiz.service.js:2455:89fd92db` · `bot/scripts/quiz/backfill-bank-quiz-audio.js:163:0da6bf9d`
- column `quizzes.meta` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` · `bot/shared/services/first-touch/teacher-home.send.js:96:f2d3025b` · `bot/shared/services/nudges/lp-coaching-ask.service.js:398:69f639a6` (+22: `python3 kg/kg.py who-reads quizzes.meta`)
- table `quiz_questions` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:89:ec1258c5`? · `bot/shared/services/quiz/lp-quiz-cache.js:155:2421430e`? · `bot/shared/services/quiz/quiz-intent-router.service.js:225:80e3fee7`? · `bot/shared/services/quiz/quiz-report.service.js:414:80e3fee7`? (+12: `python3 kg/kg.py who-reads quiz_questions`)
- table `quizzes` (written by `restore-bank-recorded-voices.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:224:2c6afb51`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:273:baba8374`? · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc`? · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca`? (+58: `python3 kg/kg.py who-reads quizzes`)
- env `FFMPEG_PATH` read at `bot/scripts/quiz/record-one-voice-shared-lines.js:64:a2264dda`

## Tests (all, generated)
- `backfill-bank-quiz-audio.js` ← `bot/tests/quiz/backfill-bank-quiz-audio.test.js`
- `backfill-quiz-language.js` ← `bot/tests/first-touch/maker.qlang.test.js` · `bot/tests/quiz/backfill-quiz-language.test.js`
- `one-voice-missing-keys.js` ← `bot/tests/quiz/one-voice-missing-keys.test.js`
- `purge-kept-child-voice.js` ← `bot/tests/quiz/web-quiz/web-quiz-challenge-keep.test.js`
- `record-one-voice-shared-lines.js` ← `bot/tests/quiz/record-one-voice-shared-lines.test.js`
- `record-welcome-lines.js` ← `bot/tests/quiz/record-welcome-lines.test.js`
- `rescore-kept-reads.js` ← `bot/tests/quiz/rescore-kept-reads.test.js`
- `restore-bank-recorded-voices.js` ← `bot/tests/quiz/restore-bank-recorded-voices.test.js`

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/quiz/CLAUDE.index.md`? · `bot/scripts/quiz/CLAUDE.md`? · `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/first-touch/CLAUDE.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.md`?
