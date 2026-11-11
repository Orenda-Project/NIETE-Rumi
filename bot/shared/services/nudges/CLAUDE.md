# nudges — Scheduled teacher nudges: store, sweeper, caps, coaching ask, quiz offer
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/nudges kg=fd70d495952c gen=34377dd45d17 overflow=75 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `teacher-nudges.sweeper.js` — periodic tick that claims and dispatches due rows
- `teacher-nudges.store.js` — reads and writes of teacher_nudges
- `caps.js` — pure weekly caps
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `pkt-time.js` | PKT calendar arithmetic (UTC+5, no DST) for scheduling teacher nudges by school day |
| `lp-quiz-offer.service.js` | The 15:00 PKT afternoon quiz offer built from lessons a teacher planned that day, one teacher_nudges row each |
| `teacher-nudges.store.js` | Main teacher_nudges store holding the scheduling guards; lp-coaching-ask.service.js:558 also updates rows directly |
| `lp-coaching-ask.service.js` | The coaching ask: one nudge on the first lesson plan a teacher takes in a day, offering recording and coaching |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? (+61)
- column `quizzes.quiz_source` (written by `lp-quiz-offer.service.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:306:fca7d9fc` (+28)
- … 33 more → `CLAUDE.index.md`

## Never (human)
- Parse nudge flags only via `flags.js` (ask took literal 'true', bd-mg9c7.159.10, `flags.js:8`)
- Compute school days in PKT arithmetic, not host local time (`pkt-time.js:6`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/quiz/lp-quiz-offer-window-template.test.js` (lp-quiz-offer.service.js, pkt-time.js, teacher-nudges.sweeper.js, window-closed-template.js)
- `bot/tests/nudges/nudge-flags.test.js` (lp-coaching-ask.service.js, lp-quiz-offer.service.js, teacher-nudges.sweeper.js)
- … 42 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/quiz-telemetry.md`? · `infrastructure/templates/drafts/README.md`?
