# quiz — Class quizzes, video quizzes, storybooks and the child web quiz (Jugnu) services
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/quiz kg=9ed827a6c19d gen=a31259c316de overflow=1399 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `web-quiz-token.js` | Pure signing and verification of web quiz tokens: session, preview, challenge, hub, guest, handset, device ref |
| … | 285 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `handout-class.service.js` (+17)) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? (+61)
- `web-quiz-token.js` ← imported by `bot/shared/routes/web-quiz-internal.routes.js:228:a3b52a32` · `bot/shared/services/child-test/app/sa-api.service.js:984:f6c99c9e` (+50)
- … 423 more → `CLAUDE.index.md`

## Never (human)
- Treat an app_settings switch as on only for JSON true; strings and failed reads are off (report-fold-flag.js:5)
- Make one lp_v8 quiz per lesson through claimLessons, never check-then-insert (lp-lesson-claim.js:9)
- Resolve a lesson's slide script by exact version only, never latest (lp-asset-source.store.js:9)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- … 778 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/features/quiz.md`? · `docs/features/video-quiz.md`? · `docs/migration/05-exam-generator.md`? · `docs/quiz-telemetry.md`?
