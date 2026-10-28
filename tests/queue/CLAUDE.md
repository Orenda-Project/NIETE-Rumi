# queue — Tests the SQS/BullMQ queue drivers, worker drain and job language handling
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/queue kg=ba808d4f175e gen=8b9af46f5a7d overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `queue-driver-parity.test.js` — both drivers expose the same method surface
- `bd-oak77-11-drain-lp612.test.js` — a deploy drain must finish in-flight lp612 authoring
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/queue --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `queue-driver-index.test.js` | Pins queue/index.js driver selection: sqs default, bullmq on QUEUE_DRIVER=bullmq, unknown falls back to sqs |
| `queue-driver-parity.test.js` | Parity guard: SQS and BullMQ queue singletons expose the same method surface the worker and producers use |
| `bullmq-queue.test.js` | Pins the BullMQ driver (mocked bullmq/ioredis): producers route queues, envelopes, delay and dedup like SQS |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bd*` | 3 files; most used `bd-yd2kb-release-inflight.test.js`: bd-yd2kb: releaseInFlightMessage returns a message to its own queue (main, video, quiz) with VisibilityTimeout 0 |
| `quiz-queue-polled-under-bullmq.test.js` | Pins that the worker polls the quiz queue under WORKER_QUEUES plus a driver that has one, not only with an SQS URL |
| `sqs-cancel-by-group.test.js` | Regression guard: SQSQueueService.cancelByGroupId exists and writes a Redis cancel flag, tolerating Redis failure |
| `job-language-territories.test.js` | Pins the language split: CONTENT language frozen in the job payload, teacher-addressed messages read current preference |

## Who reads this (generated)
- (none)

## Never (human)
- SQS and BullMQ singletons must keep identical method surfaces (queue-driver-parity.test.js:2)
- A deploy must never kill in-progress lesson-plan authoring (bd-oak77-11-drain-lp612.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/queue/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/queue/CLAUDE.index.md`? · `tests/queue/CLAUDE.md`?
