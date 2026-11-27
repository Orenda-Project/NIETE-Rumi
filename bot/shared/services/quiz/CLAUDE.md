# quiz — Class quizzes, video quizzes, storybooks and the child web quiz (Jugnu) services
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/quiz kg=02232881290f gen=0add0aa7f149 overflow=1590 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `quiz-orchestrator.service.js` — /quiz command, class selection, LP-anchored offers
- `transcript-quiz-generate.service.js` — author, validate, blind-solve, store, hand-off pipeline
- `web-quiz.service.js` — child web page API: getQuiz, startSession, recordAnswers, finishSession
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `pictures/` | Colour picture bank (Fluent Emoji glyphs) the web quiz draws nouns with → `pictures/CLAUDE.md` |
| `providers/` | Lesson providers for /quiz that make a quiz from a Grades 6-12 lesson plan → `providers/CLAUDE.md` |
| `test-practice/` | (no description yet) → `test-practice/CLAUDE.md` |
| … | 320 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `closed-window-offer.js` (+22)) ← read by `bot/scripts/quiz-teacher-edit-revert.js:72:2bad8432`? · `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? (+75)
- `web-quiz-kid.js` ← imported by `bot/shared/handlers/jugnu-command.js:46:f195e827` · `bot/shared/handlers/observe-visit-flow.handler.js:987:5e4f4f4e` (+58)
- … 466 more → `CLAUDE.index.md`

## Never (human)
- Treat an app_settings switch as on only for JSON true; strings and failed reads are off (report-fold-flag.js:5)
- Make one lp_v8 quiz per lesson through claimLessons, never check-then-insert (lp-lesson-claim.js:9)
- Resolve a lesson's slide script by exact version only, never latest (lp-asset-source.store.js:9)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- … 899 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/features/quiz.md`? · `docs/features/video-quiz.md`? · `docs/lesson-plan-data-model-debt.md`? · `docs/migration/05-exam-generator.md`? (+1)
