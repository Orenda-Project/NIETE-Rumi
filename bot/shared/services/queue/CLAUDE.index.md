# queue — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/queue -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bullmq-queue.service.js` | BullMQ Redis queue driver with the same surface as the SQS driver, for AWS-free deployments |
| `index.js` | Selects the queue driver (sqs default or bullmq) from QUEUE_DRIVER for producers and workers |
| `sqs-queue.service.js` | AWS SQS FIFO queue service for coaching, lesson plan and video jobs with dedup ids; used by sqs-worker |

## Who reads this (all, generated)
- `bullmq-queue.service.js` ← imported by `bot/shared/services/queue/index.js:17:6dd34b59`
- `index.js` ← imported by `bot/shared/routes/homework-request-endpoint.js:21:12f2ae3c` · `bot/shared/services/assessment/assessment-request.service.js:140:75453fe6` · `bot/shared/services/coaching/coaching-job-queue.service.js:96:75453fe6` · `bot/shared/services/lesson-plan-queue.service.js:13:f87ebf95` (+19: `python3 kg/kg.py who-reads index.js`)
- `sqs-queue.service.js` ← imported by `bot/shared/services/queue/index.js:26:72d57016`
- env `AWS_ACCESS_KEY_ID` read at `bot/shared/services/queue/sqs-queue.service.js:58:b1d05116`
- env `AWS_REGION` read at `bot/shared/services/queue/sqs-queue.service.js:57:2c79605f`
- env `AWS_SECRET_ACCESS_KEY` read at `bot/shared/services/queue/sqs-queue.service.js:59:2d6a8510`
- env `BULLMQ_MAIN_QUEUE` read at `bot/shared/services/queue/bullmq-queue.service.js:41:9801981e`
- env `BULLMQ_QUIZ_QUEUE` read at `bot/shared/services/queue/bullmq-queue.service.js:43:3d390258`
- env `BULLMQ_VIDEO_QUEUE` read at `bot/shared/services/queue/bullmq-queue.service.js:42:e05f2f9c`
- env `NODE_ENV` read at `bot/shared/services/queue/sqs-queue.service.js:798:d8e24952`
- env `QUEUE_DRIVER` read at `bot/shared/services/queue/index.js:14:710952b9`
- env `REDIS_URL` read at `bot/shared/services/queue/bullmq-queue.service.js:52:d78719e9`
- env `SQS_DLQ_URL` read at `bot/shared/services/queue/sqs-queue.service.js:66:a5cf1989`
- env `SQS_QUEUE_URL` read at `bot/shared/services/queue/sqs-queue.service.js:63:5f8b2a33`
- env `SQS_QUIZ_QUEUE_URL` read at `bot/shared/services/queue/sqs-queue.service.js:65:db4f9149`
- env `SQS_VIDEO_QUEUE_URL` read at `bot/shared/services/queue/sqs-queue.service.js:64:b69a4676`

## Tests (all, generated)
- `bullmq-queue.service.js` ← `tests/llm/cost-user-attribution.test.js` · `tests/queue/bullmq-queue.test.js` · `tests/queue/queue-driver-index.test.js` · `tests/queue/queue-driver-parity.test.js` · `tests/quiz/quiz-queue-uses-driver.test.js`
- `index.js` ← `bot/tests/quiz/old-link-redirect.test.js` · `bot/tests/workers/quiz-queue-own-loop.test.js` · `tests/fflp/queue-worker.test.js` · `tests/fflp/seam-goldens.test.js` · `tests/lesson-plan-lifecycle/grounded-path.test.js` · `tests/lesson-plan-lifecycle/requeue-grounded.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/queue/index.js`)
- `sqs-queue.service.js` ← `bot/tests/observe/bd-lh9c2-dedup-nonce-wired.test.js` · `bot/tests/observe/bd-rkofm-lang-toggle-dedup.test.js` · `bot/tests/observe/observe-debrief-requeue.test.js` · `bot/tests/quiz/chat-quiz-report-send-checked.test.js` · `bot/tests/quiz/lp-quiz-list.test.js` · `bot/tests/quiz/lp-quiz-queue-failed.test.js` (+40: `python3 kg/kg.py who-reads bot/shared/services/queue/sqs-queue.service.js`)

## Related (all, generated)
- docs: `CLAUDE.md`? · `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/README.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.index.md`? · `bot/tests/workers/CLAUDE.md`? · `docs/agent-customization.md`? · `docs/architecture.md`?
