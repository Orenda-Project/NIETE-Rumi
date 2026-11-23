# workers — SQS job worker, cron sweeps and per-job handlers run outside the web process
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/workers kg=8ec4b51a2f8c gen=b2d26496c193 overflow=159 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `sqs-worker.js` — queue poller and jobType router
- `stale-session.worker.js` — cron for stuck coaching sessions
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sqs-worker.js` | Main SQS worker entry: long-polls queues and routes each jobType to its handler with visibility heartbeats |
| `lp612*` | 3 files; most used `lp612-author.worker.js`: SQS job authoring, rendering, storing and delivering a 6-12 lesson for one segment/lang/template version |
| `stale-session.worker.js` | 15-minute Railway cron sweeping stuck coaching sessions: reminders, auto-complete, recovery |
| `lesson-plan-generation.worker.js` | SQS lesson-plan generation worker with retries, apology on max failures and free-form track routing |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `lesson-plan-extraction.worker.js` (+2)) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/shared/calls/call-context.repo.js:63:5911672a`? (+99)
- column `coaching_sessions.status` (written by `sqs-worker.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:57:23fca46d` (+45)
- … 78 more → `CLAUDE.index.md`

## Never (human)
- lp612_author runs under a visibility heartbeat, not one fixed extension (sqs-worker.js:674, :703, bd-awqt3)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` (sqs-worker.js, stale-session.worker.js)
- `tests/quiz/quiz-retest-schedule.test.js` (quiz-retest-schedule.js, sqs-worker.js)
- … 97 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`? · `video-generation`?
- docs: `bot/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/LP_PATHS.md`? · `docs/agent-customization.md`? · `docs/architecture.md`? · `docs/attendance-bigquery-sync.md`? (+7)
- … 1 more → `CLAUDE.index.md`
