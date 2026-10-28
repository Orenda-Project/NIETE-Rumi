# tasks — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/scoring/tasks -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `common.js` | Shared v3 task-scorer pieces: clock, EGRA/EGMA stop rules, fluency rate, review rules, ai-marks-v3 shape (bd-s1oo0.50.3) |
| `engine.js` | The timed and untimed v3 task engines (clip cut, audio-model call, per-item rows, stop rule) used by task scorers |
| `fluency.js` | Scorer for v3 ma.number_id, ma.add1 and ma.sub1 (20 items, 60s, no stop rule) |
| `index.js` | Dispatches a v3 task to its per-kind scorer and returns ai-marks-v3 |
| `letters.js` | Scorer for v3 letters tasks: 100 letters in 60s, first-row stop, two-variant Gemini count with tolerance flagging |
| `listening.js` | Scorer for v3 listening comprehension: Gemini grades the whole-note transcript against accepted answers |
| `oral.js` | Scorer for untimed EGMA tasks (discrimination, missing, add2, sub2, word problems) with 4-error stop |
| `prompts.js` | Per-task v3 prompts ported word for word from the R8 measurement lane, filled with bank item lists |
| `story.js` | Scorer for v3 story: reading via story.js plus reach-aware comprehension, clock and first-line stop |
| `wordlist.js` | Scorer for v3 familiar-word and made-up-word lists (50 items, first-5 stop) using the STORY prompt |

## Who reads this (all, generated)
- `common.js` ← imported by `bot/shared/services/quiz/web-quiz-challenge.js:111:2d87cd99` · `bot/shared/services/child-test/scoring/tasks/engine.js:15:ed7752a5` · `bot/shared/services/child-test/scoring/tasks/index.js:16:ed7752a5` · `bot/shared/services/child-test/scoring/tasks/listening.js:13:ed7752a5` (+1: `python3 kg/kg.py who-reads common.js`)
- `engine.js` ← imported by `bot/shared/services/child-test/scoring/tasks/fluency.js:9:db60f2eb` · `bot/shared/services/child-test/scoring/tasks/letters.js:12:db60f2eb` · `bot/shared/services/child-test/scoring/tasks/oral.js:10:093fb71b` · `bot/shared/services/child-test/scoring/tasks/wordlist.js:13:db60f2eb`
- `fluency.js` ← imported by `bot/shared/services/child-test/scoring/tasks/index.js:24:967b8bd1`
- `index.js` ← imported by `bot/shared/services/child-test/scoring/index.js:56:32b039a0` · `bot/shared/services/quiz/web-quiz-challenge.js:113:ca13ea61`
- `letters.js` ← imported by `bot/shared/services/child-test/scoring/tasks/index.js:20:5c867406`
- `listening.js` ← imported by `bot/shared/services/child-test/scoring/tasks/index.js:19:729c1ee1`
- `oral.js` ← imported by `bot/shared/services/child-test/scoring/tasks/index.js:27:ed37931b`
- `prompts.js` ← imported by `bot/shared/services/child-test/sa/score.js:301:c39e83bd` · `bot/shared/services/child-test/scoring/tasks/fluency.js:8:8194ea63` · `bot/shared/services/child-test/scoring/tasks/letters.js:11:8194ea63` · `bot/shared/services/child-test/scoring/tasks/listening.js:10:8194ea63` (+1: `python3 kg/kg.py who-reads prompts.js`)
- `story.js` ← imported by `bot/shared/services/child-test/scoring/tasks/index.js:23:50834e88`
- `wordlist.js` ← imported by `bot/shared/services/child-test/scoring/tasks/index.js:21:ba6b2614`

## Tests (all, generated)
- `common.js` ← `tests/child-test/L37/score-task.test.js` · `tests/child-test/L40/e2e-scoring-fixes.test.js` · `tests/child-test/L40/finish-time.test.js` · `tests/child-test/L40/review-seam.test.js`
- `engine.js` ← `tests/coaching/video-reco/engine.test.js`?

## Related (all, generated)
- docs: `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.md`?
