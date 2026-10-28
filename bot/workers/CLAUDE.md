# workers — SQS job worker, cron sweeps and per-job handlers run outside the web process
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/workers kg=2efc566a6048 gen=cd3fb9ff29a2 overflow=130 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `sqs-worker.js` — queue poller and jobType router
- `stale-session.worker.js` — cron for stuck coaching sessions
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sqs-worker.js` | Main SQS worker entry: long-polls queues and routes each jobType to its handler with visibility heartbeats |
| `lp612-author.worker.js` | SQS job authoring, rendering, storing and delivering a 6-12 lesson for one segment/lang/template version |
| `CLAUDE.index.md` | (unmapped) |
| `stale-session.worker.js` | 15-minute Railway cron sweeping stuck coaching sessions: reminders, auto-complete, recovery |
| `lesson-plan-generation.worker.js` | SQS lesson-plan generation worker with retries, apology on max failures and free-form track routing |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `lesson-plan-extraction.worker.js` (+2)) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- table `quiz_sessions` (written by `quiz-job-handler.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:144:a4d322ab`? · `bot/shared/handlers/text-message.handler.js:258:e211522c`? (+45)
- column `coaching_sessions.status` (written by `sqs-worker.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` (+42)
- … 42 more → `CLAUDE.index.md`

## Never (human)
- lp612_author runs under a visibility heartbeat, not one fixed extension (sqs-worker.js:674, :703, bd-awqt3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` (sqs-worker.js, stale-session.worker.js)
- `tests/quiz/quiz-retest-schedule.test.js` (quiz-retest-schedule.js, sqs-worker.js)
- … 76 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`? · `video-generation`?
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/nudges/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/push/CLAUDE.md`? (+32)
- … 1 more → `CLAUDE.index.md`
