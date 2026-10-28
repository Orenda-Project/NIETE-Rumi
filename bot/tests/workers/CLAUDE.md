# workers — Tests that drive the real SQS worker: queues, sweeps, visibility, boot lines
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/workers kg=220b5af4ec40 gen=edb335f47258 overflow=4 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `worker-queues.test.js` — WORKER_QUEUES resolution and queue isolation
- `undelivered-sweep.test.js` — periodic-job contract: dark by default, capped, single-flight
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `challenge-voice-sweep.test.js` | Pins that the Challenge child-voice orphan sweep is scheduled hourly only on main-queue replicas (sqs-worker) |
| `coach-voice-note-sweep.test.js` | Pins 30-day coach voice-note sweep: daily on main-queue replicas only, first pass 4 min after boot (bd-v0toag.67) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `quiz-queue-own-loop.test.js` | Pins that the quiz queue has its own poll loop beside main, honouring QUIZ_QUEUE_CONCURRENCY slot budget |
| `bd-2kxxa3-debrief-retry-sweep-glue.test.js` | Pins the debrief retry sweep worker glue: Redis setNX single-flight, .limit(20) per tick, own dedup phase (bd-2kxxa.3) |
| `bd-gc1ge-photo-gate-greeting.test.js` | Pins that the photo-gate auto-advance greeting handles a null or empty name and non-English readers (bd-gc1ge) |
| `undelivered-sweep.test.js` | Pins the undelivered-state sweep: ships dark (unset means OFF), kill switch values, cap and single-flight rules |
| `long-job-visibility.test.js` | Pins that long coaching jobs (analysis, transcription) keep extending their SQS message visibility while running |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `OBSERVE_DEBRIEF_RETRY_OFF` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `SQS_QUEUE_URL` · `SQS_QUIZ_QUEUE_URL` · `TEACHER_NUDGES_ENABLED` · `WEB_QUIZ_VOICE_SWEEP` · `WORKER_QUEUES`

## Never (human)
- Empty WORKER_QUEUES never means polling nothing (tests/workers/worker-queues.test.js:48)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/workers/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.md`? (+1)
