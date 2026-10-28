# queue — Tests for the portal SQS queue service and worker (transcript and AMA jobs)

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests/queue kg=67a1defe474d gen=618c7daaf18b overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal-sqs.service.test.js` — queue service tests; Run: cd dashboard && ./run-tests.sh tests/queue --maxWorkers=2
- `portal-sqs-worker.test.js` — worker tests; NOT matched by jest.config.js testRegex, so it never runs by default
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `portal-sqs.service.test.js` | Tests services/portal-sqs.service queueing of transcript and AMA processing jobs |
| `portal-sqs-worker.test.js` | Tests the portal SQS worker (portal-sqs-worker): transcript refinement and AMA SQL generation jobs |

## Who reads this (generated)
- env read here: `SQS_PORTAL_QUEUE_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/services/queue/CLAUDE.md`? · `dashboard/tests/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.md`? · `dashboard/tests/queue/CLAUDE.md`?
