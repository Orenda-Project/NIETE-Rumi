# scoring — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/scoring -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `tasks/` | Per-task v3 scorers (letters, words, story, listening, maths) on shared engines → `tasks/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `assemble.js` | Assembles one block's scorer outputs into contract ai_marks (v1/v2); missing items become none with confidence 0 |
| `child-no.js` | Reads the child number off a strip photo with a bounded 8s vision call; null means fall back to list order (bd-s1oo0.38) |
| `comprehension.js` | Grades comprehension answers from the diarised transcript with a Gemini text grader and accept/reject lists |
| `index.js` | scoreBlock/scoreTask: scores one coach-recorded block, writes ai_marks once and records failure reasons (bd-s1oo0.5) |
| `labeller.js` | Fallback Gemini labeller naming transcript turns for sections whose cue phrase was not found |
| `llm.js` | One JSON-returning model call through llm-client (OpenRouter) that never throws; reports cost and latency |
| `maths-oral.js` | Scores oral maths from one voice note (compare, sums, word problems) in v2 CHILD_TEST_MATHS_MODE=oral (L27) |
| `maths-photo.js` | Reads the written maths strip photo with vision, blind to the key, and checks the corner form code |
| `maths-spoken.js` | Deterministic scoring of spoken numbers and quick sums by aligning number words to the item bank |
| `maths.js` | Maths block entry: spoken numbers/sums, word problems and strip photo scorers combined |
| `media.js` | Downloads block media from R2, probes duration and cuts audio clips with ffmpeg for the scorers |
| `models.js` | Resolves which model each childTest.* scoring job runs from the model registry with per-job env overrides |
| `number-grammar.js` | Turns spoken Urdu/English number words or digits into integers with word-index ranges for timestamps |
| `phonics.js` | Scores first sounds (hint only) and made-up words with Gemini, SpeechAce or Soniox agreement capping confidence |
| `prompts.js` | Model prompts for child-test scoring (story prompt verbatim from the May 2026 study); editing invalidates measurement |
| `reach.js` | Defines which comprehension questions a child reached from words attempted; used by scorer, step, card and review |
| `speechace.js` | SpeechAce scripted scoring for English stories in two 30s calls; quality under 40 counts as wrong |
| `story.js` | Scores the 60-second story: words correct/attempted and per-word chips from Gemini, Soniox alignment, SpeechAce |
| `stt.js` | Soniox async transcription via AudioService with diarization and forced language per block; abortable |
| `text-norm.js` | Word normalisation, one-edit same-word rule and alignment ported from the May 2026 study harness |
| `thresholds.js` | Per-field confidence bars from the May 2026 study; check Flow pre-fills a field only above its bar |
| `windows.js` | Cuts a block's voice note into sections using Soniox words, cue phrases and the items themselves |

## Who reads this (all, generated)
- `assemble.js` ← imported by `bot/shared/services/child-test/scoring/index.js:52:227d9e7f`
- `child-no.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:52:650092cc` · `bot/shared/services/child-test/scoring/maths-photo.js:19:a3fd3f16`
- `comprehension.js` ← imported by `bot/shared/services/child-test/scoring/index.js:48:9bbe5521` · `bot/shared/services/child-test/scoring/tasks/story.js:12:9146c77e`
- `index.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:110:e3eb72a4`
- `labeller.js` ← imported by `bot/shared/services/child-test/scoring/index.js:46:406accba`
- `llm.js` ← imported by `bot/shared/services/child-test/sa/score.js:346:a4319e29` · `bot/shared/services/child-test/scoring/child-no.js:18:0aeeb15e` · `bot/shared/services/child-test/scoring/comprehension.js:11:0aeeb15e` · `bot/shared/services/child-test/scoring/labeller.js:10:0aeeb15e` (+7: `python3 kg/kg.py who-reads llm.js`)
- `maths-oral.js` ← imported by `bot/shared/services/child-test/scoring/index.js:53:4dd97a69`
- `maths-photo.js` ← imported by `bot/shared/services/child-test/scoring/index.js:51:4fa8f9ca`
- `maths-spoken.js` ← imported by `bot/shared/services/child-test/scoring/maths.js:13:1cec2d10`
- `maths.js` ← imported by `bot/shared/services/child-test/scoring/index.js:50:a11b8d43`
- `media.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:703:506111ff` · `bot/shared/services/child-test/sa/score.js:344:506111ff` · `bot/shared/services/quiz/web-quiz-challenge.js:113:ca13ea61` · `bot/shared/services/child-test/scoring/index.js:43:bee29241` (+3: `python3 kg/kg.py who-reads media.js`)
- `models.js` ← imported by `bot/shared/services/child-test/sa/score.js:347:1df8788a` · `bot/shared/services/child-test/scoring/child-no.js:17:46763490` · `bot/shared/services/child-test/scoring/comprehension.js:10:46763490` · `bot/shared/services/child-test/scoring/index.js:55:46763490` (+8: `python3 kg/kg.py who-reads models.js`)
- `number-grammar.js` ← imported by `bot/shared/services/child-test/scoring/child-no.js:19:04769ee3` · `bot/shared/services/child-test/scoring/maths-oral.js:24:35768112` · `bot/shared/services/child-test/scoring/maths-photo.js:18:04769ee3` · `bot/shared/services/child-test/scoring/maths-spoken.js:11:07f0f249`
- `phonics.js` ← imported by `bot/shared/services/child-test/scoring/index.js:49:5cff5cee`
- `prompts.js` ← imported by `bot/shared/services/child-test/sa/score.js:596:cf71ae7d` · `bot/shared/services/child-test/scoring/child-no.js:16:326b6a90` · `bot/shared/services/child-test/scoring/comprehension.js:9:326b6a90` · `bot/shared/services/child-test/scoring/labeller.js:8:326b6a90` (+6: `python3 kg/kg.py who-reads prompts.js`)
- `reach.js` ← imported by `bot/shared/services/child-test/conversation/steps-v3.js:30:ed9fb627` · `bot/shared/services/child-test/conversation/steps.js:22:ed9fb627` · `bot/shared/services/child-test/render/v2.js:24:ed9fb627` · `bot/shared/services/child-test/render/v3.js:29:ed9fb627` (+3: `python3 kg/kg.py who-reads reach.js`)
- `speechace.js` ← imported by `bot/shared/services/child-test/scoring/phonics.js:21:fb660775` · `bot/shared/services/child-test/scoring/story.js:19:fb660775`
- `story.js` ← imported by `bot/shared/services/child-test/sa/score.js:597:fb42ee15` · `bot/shared/services/child-test/scoring/index.js:47:dd68f865` · `bot/shared/services/child-test/scoring/tasks/story.js:11:e939c7c1` · `bot/shared/services/child-test/scoring/tasks/wordlist.js:11:64cadbf9`
- `stt.js` ← imported by `bot/scripts/quiz/one-voice-missing-keys.js:107:cc9be969` · `bot/shared/services/child-test/app/sa-api.service.js:704:7d5bb675` · `bot/shared/services/child-test/sa/score.js:363:ef87b52c` · `bot/shared/services/child-test/scoring/comprehension.js:12:54906d5b` (+5: `python3 kg/kg.py who-reads stt.js`)
- `text-norm.js` ← imported by `bot/scripts/quiz/one-voice-missing-keys.js:82:3b9dd554` · `bot/shared/services/child-test/sa/last-word-hint.js:15:81b9c396` · `bot/shared/services/child-test/scoring/comprehension.js:13:156fff68` · `bot/shared/services/child-test/scoring/maths-oral.js:23:e06db987` (+7: `python3 kg/kg.py who-reads text-norm.js`)
- `thresholds.js` ← imported by `bot/shared/services/child-test/check-flow/bars.js:25:99c50627` · `bot/shared/services/child-test/check-flow/review-view.js:9:001dd5b9` · `bot/shared/services/child-test/scoring/assemble.js:11:32a79cfd` · `bot/shared/services/child-test/scoring/comprehension.js:14:e0394242` (+1: `python3 kg/kg.py who-reads thresholds.js`)
- `windows.js` ← imported by `bot/shared/services/child-test/scoring/index.js:45:eb639da2` · `bot/shared/services/child-test/scoring/labeller.js:12:680f81c4` · `bot/shared/services/child-test/scoring/maths-oral.js:22:77187dec` · `bot/shared/services/child-test/scoring/maths.js:12:d92a5454` (+4: `python3 kg/kg.py who-reads windows.js`)
- env `CHILD_TEST_CHILD_NO_TIMEOUT_MS` read at `bot/shared/services/child-test/scoring/child-no.js:25:32197e63`
- env `CHILD_TEST_SPEECHACE` read at `bot/shared/services/child-test/scoring/speechace.js:17:fd893da9`
- env `FFMPEG_PATH` read at `bot/shared/services/child-test/scoring/media.js:13:a2264dda`
- env `SONIOX_ASYNC_USD_PER_HOUR` read at `bot/shared/services/child-test/scoring/stt.js:11:9adb61b3`
- env `SPEECHACE_API_KEY` read at `bot/shared/services/child-test/scoring/speechace.js:17:fd893da9`
- env `SPEECHACE_ENDPOINT` read at `bot/shared/services/child-test/scoring/speechace.js:27:a882aae2`

## Tests (all, generated)
- `assemble.js` ← `tests/child-test/L34/comprehension-reach.test.js` · `tests/child-test/L5/assemble.test.js`
- `child-no.js` ← `tests/child-test/L20/child-no-reader.test.js`
- `comprehension.js` ← `tests/child-test/L34/comprehension-reach.test.js`
- `index.js` ← `tests/child-test/L15/no-json-detail.test.js` · `tests/child-test/L16/urdu-nonword-confidence.test.js` · `tests/child-test/L18/nonreader-story.test.js` · `tests/child-test/L24/score-block-wiring.test.js` · `tests/child-test/L27/score-block-v2.test.js` · `tests/child-test/L30/reader-cap.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/child-test/scoring/index.js`)
- `labeller.js` ← `tests/child-test/L11/scorer-quick-sums.test.js`
- `llm.js` ← `bot/tests/child-test/sa-score-sweep-claims.test.js` · `bot/tests/child-test/sa-score-timeouts.test.js` · `tests/child-test/L18/nonreader-story.test.js`
- `maths-oral.js` ← `tests/child-test/L27/maths-oral.test.js` · `tests/child-test/L27/oral-bars.test.js`
- `maths-photo.js` ← `tests/child-test/L20/child-no-reader.test.js` · `tests/child-test/L5/maths-photo.test.js`
- `maths-spoken.js` ← `tests/child-test/L5/maths-spoken.test.js`
- `media.js` ← `bot/tests/child-test/sa-score-sweep-claims.test.js` · `bot/tests/child-test/sa-score-timeouts.test.js`
- `number-grammar.js` ← `tests/child-test/L5/number-grammar.test.js`
- `prompts.js` ← `tests/child-test/L18/nonreader-story.test.js` · `tests/child-test/L20/child-no-reader.test.js`
- `reach.js` ← `tests/child-test/L34/coach-card-reach.test.js` · `tests/child-test/L34/reach.test.js` · `tests/child-test/L34/step-reach.test.js` · `tests/child-test/L38/print-pack-v3.test.js`
- `story.js` ← `tests/child-test/L24/stop-rule.test.js` · `tests/child-test/L30/reader-cap.test.js` · `tests/child-test/L5/story-pure.test.js`
- `stt.js` ← `bot/tests/child-test/sa-score-timeouts.test.js` · `tests/child-test/L40/e2e-scoring-fixes.test.js`
- `text-norm.js` ← `dashboard/tests/web-quiz-challenge-live.service.test.js` · `tests/child-test/L11/scorer-quick-sums.test.js` · `tests/child-test/L24/story-minute.test.js` · `tests/child-test/L27/oral-transcripts.js` · `tests/child-test/L32/coach-switch.test.js` · `tests/child-test/L40/e2e-scoring-fixes.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/child-test/scoring/text-norm.js`)
- `thresholds.js` ← `tests/child-test/L16/urdu-nonword-confidence.test.js` · `tests/child-test/L24/questions-bar.test.js` · `tests/child-test/L27/oral-bars.test.js` · `tests/child-test/L5/assemble.test.js` · `tests/child-test/L5/thresholds.test.js` · `tests/child-test/L6/real-thresholds.test.js`
- `windows.js` ← `tests/child-test/L11/scorer-quick-sums.test.js` · `tests/child-test/L24/story-minute.test.js` · `tests/child-test/L32/coach-switch.test.js` · `tests/child-test/L5/maths-spoken.test.js` · `tests/child-test/L5/story-pure.test.js` · `tests/child-test/L5/windows.test.js`

## Related (all, generated)
- docs: `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.md`? · `bot/tests/child-test/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.md`? · `tests/child-test/L11/CLAUDE.md`? · `tests/child-test/L15/CLAUDE.md`? · `tests/child-test/L16/CLAUDE.md`? · `tests/child-test/L18/CLAUDE.md`? · `tests/child-test/L20/CLAUDE.md`? · `tests/child-test/L24/CLAUDE.md`? · `tests/child-test/L27/CLAUDE.md`? · `tests/child-test/L30/CLAUDE.md`? · `tests/child-test/L32/CLAUDE.md`? · `tests/child-test/L34/CLAUDE.md`? · `tests/child-test/L38/CLAUDE.md`? · `tests/child-test/L40/CLAUDE.md`? · `tests/child-test/L5/CLAUDE.md`? · `tests/child-test/L6/CLAUDE.index.md`? · `tests/child-test/L6/CLAUDE.md`?
