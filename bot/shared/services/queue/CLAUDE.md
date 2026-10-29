# queue — Queue driver selector: SQS default or BullMQ over Redis, same method surface
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/queue kg=614d895fdf54 gen=21157ad8926a overflow=50 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.js` — QUEUE_DRIVER selection used by producers and sqs-worker
- `sqs-queue.service.js` — FIFO producer/consumer with buildDedupId
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sqs-queue.service.js` | AWS SQS FIFO queue service for coaching, lesson plan and video jobs with dedup ids; used by sqs-worker |
| `index.js` | Selects the queue driver (sqs default or bullmq) from QUEUE_DRIVER for producers and workers |
| `bullmq-queue.service.js` | BullMQ Redis queue driver with the same surface as the SQS driver, for AWS-free deployments |

## Who reads this (generated)
- `index.js` ← imported by `bot/shared/routes/homework-request-endpoint.js:21:12f2ae3c` · `bot/shared/services/assessment/assessment-request.service.js:140:75453fe6` (+21)
- `bullmq-queue.service.js` ← imported by `bot/shared/services/queue/index.js:17:6dd34b59`
- `sqs-queue.service.js` ← imported by `bot/shared/services/queue/index.js:26:72d57016`
- env read here: `AWS_ACCESS_KEY_ID` · `AWS_REGION` · `AWS_SECRET_ACCESS_KEY` · `BULLMQ_MAIN_QUEUE` · `BULLMQ_QUIZ_QUEUE` · `BULLMQ_VIDEO_QUEUE` · `NODE_ENV` · `QUEUE_DRIVER` · `REDIS_URL` · `SQS_DLQ_URL` · `SQS_QUEUE_URL` · `SQS_QUIZ_QUEUE_URL` (+1)

## Never (human)
- BullMQ must expose the exact SQS surface (`bot/shared/services/queue/bullmq-queue.service.js:4`)
- Dedup id must include the phase (bd-2652, `bot/shared/services/queue/sqs-queue.service.js:38`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/queue/queue-driver-index.test.js` (bullmq-queue.service.js, index.js, sqs-queue.service.js)
- `tests/llm/cost-user-attribution.test.js` (bullmq-queue.service.js, sqs-queue.service.js)
- `tests/queue/queue-driver-parity.test.js` (bullmq-queue.service.js, sqs-queue.service.js)
- `tests/quiz/quiz-queue-uses-driver.test.js` (bullmq-queue.service.js, sqs-queue.service.js)
- `bot/tests/observe/bd-lh9c2-dedup-nonce-wired.test.js` (sqs-queue.service.js)
- … 50 more → `CLAUDE.index.md`

## Related (generated)
- docs: `CLAUDE.md`? · `bot/CLAUDE.md`? · `bot/README.md`? · `bot/shared/services/CLAUDE.md`? · `docs/agent-customization.md`? · `docs/architecture.md`?
