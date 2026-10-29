# queue — SQS client for portal-only async jobs

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/services/queue kg=c2396f5c7c3b gen=19bff2ab98e1 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `portal-sqs.service.js` — enqueue transcript and AMA jobs
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `portal-sqs.service.js` | Queues transcript-processing and AMA jobs onto the portal's dedicated SQS_PORTAL_QUEUE_URL FIFO queue. |

## Who reads this (generated)
- `portal-sqs.service.js` ← imported by `dashboard/index.js:95:baa378a7` · `dashboard/workers/portal-sqs-worker.js:14:2edc8bc2` (+1)
- env read here: `AWS_ACCESS_KEY_ID` · `AWS_REGION` · `AWS_SECRET_ACCESS_KEY` · `SQS_PORTAL_QUEUE_URL`

## Never (human)
- Never share the main bot's queue; use SQS_PORTAL_QUEUE_URL (`portal-sqs.service.js:8`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/queue/portal-sqs.service.test.js` (portal-sqs.service.js)

## Related (generated)
- docs: `dashboard/services/CLAUDE.md`?
