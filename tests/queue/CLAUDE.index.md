# queue — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/queue -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bd-oak77-11-drain-lp612.test.js` | bd-oak77.11: the SQS worker drain finishes an in-flight lp612_author job past the 30s deadline; other jobs release |
| `bd-oak77-11-flush-before-exit.test.js` | bd-oak77.11: exitAfterFlush waits for log flush before exit, with a backstop and exactly-once exit |
| `bd-yd2kb-release-inflight.test.js` | bd-yd2kb: releaseInFlightMessage returns a message to its own queue (main, video, quiz) with VisibilityTimeout 0 |
| `bullmq-queue.test.js` | Pins the BullMQ driver (mocked bullmq/ioredis): producers route queues, envelopes, delay and dedup like SQS |
| `job-language-territories.test.js` | Pins the language split: CONTENT language frozen in the job payload, teacher-addressed messages read current preference |
| `queue-driver-index.test.js` | Pins queue/index.js driver selection: sqs default, bullmq on QUEUE_DRIVER=bullmq, unknown falls back to sqs |
| `queue-driver-parity.test.js` | Parity guard: SQS and BullMQ queue singletons expose the same method surface the worker and producers use |
| `quiz-queue-polled-under-bullmq.test.js` | Pins that the worker polls the quiz queue under WORKER_QUEUES plus a driver that has one, not only with an SQS URL |
| `sqs-cancel-by-group.test.js` | Regression guard: SQSQueueService.cancelByGroupId exists and writes a Redis cancel flag, tolerating Redis failure |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/services/queue/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/queue/CLAUDE.index.md`? · `tests/queue/CLAUDE.md`?
