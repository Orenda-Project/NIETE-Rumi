# workers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/workers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bd-2kxxa3-debrief-retry-sweep-glue.test.js` | Pins the debrief retry sweep worker glue: Redis setNX single-flight, .limit(20) per tick, own dedup phase (bd-2kxxa.3) |
| `bd-gc1ge-photo-gate-greeting.test.js` | Pins that the photo-gate auto-advance greeting handles a null or empty name and non-English readers (bd-gc1ge) |
| `challenge-voice-sweep.test.js` | Pins that the Challenge child-voice orphan sweep is scheduled hourly only on main-queue replicas (sqs-worker) |
| `coach-voice-note-sweep.test.js` | Pins 30-day coach voice-note sweep: daily on main-queue replicas only, first pass 4 min after boot (bd-v0toag.67) |
| `long-job-visibility.test.js` | Pins that long coaching jobs (analysis, transcription) keep extending their SQS message visibility while running |
| `quiz-queue-own-loop.test.js` | Pins that the quiz queue has its own poll loop beside main, honouring QUIZ_QUEUE_CONCURRENCY slot budget |
| `quiz-web-audio-job.test.js` | Pins that the worker records web-quiz read-aloud clips via the quiz_web_audio job, at most 2 at once per worker |
| `resume-sweep-tick-line.test.js` | Pins that the interrupted-task resume sweep tick line logs a deferred-for-quiet-hours count on sqs-worker |
| `undelivered-sweep.test.js` | Pins the undelivered-state sweep: ships dark (unset means OFF), kill switch values, cap and single-flight rules |
| `web-quiz-config-boot-line.test.js` | Pins that every worker logs web_quiz.config once at boot so a deploy shows agreement on bucket, host and secret |
| `worker-queues.test.js` | Pins WORKER_QUEUES resolution: unset means all queues, empty never polls nothing, main,quiz excludes video (bd-2240) |

## Who reads this (all, generated)
- env `OBSERVE_DEBRIEF_RETRY_OFF` read at `bot/tests/workers/bd-2kxxa3-debrief-retry-sweep-glue.test.js:74:d5a7a752`
- env `OPENAI_API_KEY` read at `bot/tests/workers/bd-2kxxa3-debrief-retry-sweep-glue.test.js:20:acce1dae` · `bot/tests/workers/challenge-voice-sweep.test.js:23:acce1dae` · `bot/tests/workers/coach-voice-note-sweep.test.js:25:acce1dae` · `bot/tests/workers/long-job-visibility.test.js:55:acce1dae` · `bot/tests/workers/quiz-queue-own-loop.test.js:37:acce1dae` · `bot/tests/workers/resume-sweep-tick-line.test.js:20:acce1dae` · `bot/tests/workers/web-quiz-config-boot-line.test.js:11:acce1dae` · `bot/tests/workers/worker-queues.test.js:30:acce1dae`
- env `OPENROUTER_API_KEY` read at `bot/tests/workers/bd-2kxxa3-debrief-retry-sweep-glue.test.js:19:1370b6dc` · `bot/tests/workers/challenge-voice-sweep.test.js:22:1370b6dc` · `bot/tests/workers/coach-voice-note-sweep.test.js:24:1370b6dc` · `bot/tests/workers/long-job-visibility.test.js:54:1370b6dc` · `bot/tests/workers/quiz-queue-own-loop.test.js:36:1370b6dc` · `bot/tests/workers/quiz-web-audio-job.test.js:34:1370b6dc` · `bot/tests/workers/resume-sweep-tick-line.test.js:19:1370b6dc` · `bot/tests/workers/web-quiz-config-boot-line.test.js:10:1370b6dc` · `bot/tests/workers/worker-queues.test.js:29:1370b6dc`
- env `SQS_QUEUE_URL` read at `bot/tests/workers/long-job-visibility.test.js:56:0421d2d5` · `bot/tests/workers/quiz-web-audio-job.test.js:35:9ab44531`
- env `SQS_QUIZ_QUEUE_URL` read at `bot/tests/workers/quiz-web-audio-job.test.js:36:36a14349`
- env `TEACHER_NUDGES_ENABLED` read at `bot/tests/workers/resume-sweep-tick-line.test.js:109:b561e903` · `bot/tests/workers/web-quiz-config-boot-line.test.js:101:2808cd9c`
- env `WEB_QUIZ_VOICE_SWEEP` read at `bot/tests/workers/challenge-voice-sweep.test.js:30:9f811a8e`
- env `WORKER_QUEUES` read at `bot/tests/workers/challenge-voice-sweep.test.js:30:9f811a8e` · `bot/tests/workers/coach-voice-note-sweep.test.js:31:ea3d3b39` · `bot/tests/workers/worker-queues.test.js:34:ea3d3b39`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/workers/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.md`? · `bot/workers/CLAUDE.index.md`?
