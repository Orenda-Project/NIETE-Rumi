# lesson-plan-lifecycle — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/lesson-plan-lifecycle -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `helpers/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `generation-failed-attempts.test.js` | Pins lesson_plan.generation.failed attempt number and final flag across SQS retries (limit 3) in the generation worker |
| `grounded-path.test.js` | Pins grounded (curriculum) LP lifecycle columns written only when switched on, incl. SQS enqueue failure handling |
| `health-alert.test.js` | Pins lesson-plan health alert: a non-healthy tick sends one message naming all reasons via the quiz watcher channel |
| `health-check.test.js` | Pins the hourly lesson-plan health check over lesson_plan_requests: off by default, per-path/channel summary, verdicts |
| `health-fflp-track.test.js` | Pins per-free-form-track health summary (textbook_metadata.fflp_track) so a free-form outage isn't charged to Gamma |
| `health-route.test.js` | Pins GET /api/internal/lp/health: internal key required, off/ok/degraded payloads, 503 on read failure |
| `health-tick-cadence.test.js` | Pins that the health check runs hourly after the boot run and two replicas still check once per tick (Redis claim) |
| `health-worker-wiring.test.js` | Pins sqs-worker health-check wiring: boot run, hourly tick, main-queue only, LP_HEALTH_CHECK=off, errors contained |
| `homework-path.test.js` | Pins homework Flow lifecycle rows: request insert, plan rows naming the request, outcome; unchanged when OFF |
| `legacy-lanes.test.js` | Pins lifecycle rows for the pre-generated chapter and Oxbridge lanes (completed/DELIVERY_FAILED, none when OFF) |
| `lp612-leader.test.js` | bd-4joiqz: pins that a portal LEADER's grade 6-12 ask writes a claim but no lifecycle row; a teacher's still does |
| `lp612-path.test.js` | Pins grade 6-12 deliverRender lifecycle rows: ledger row names request, FAILED row on Meta refusal, none when OFF |
| `lp612-worker-portal.test.js` | Pins lp612-author worker writing a lifecycle row when a portal-waiting 6-12 lesson becomes ready, and on give-up |
| `oxbridge-picker-webhook.test.js` | Pins Oxbridge picker tap via real /webhook leaving a completed niete_oxbridge lifecycle row with the teacher id |
| `pregen-artifact-ref.test.js` | Pins typed ask served a pre-generated chapter: lifecycle artifact_ref is the pre_generated_lps row id |
| `queue-own-row-read-failed.test.js` | Pins queue source-read failure reporting: write_failed counted each time, error logged at most once per 10 min |
| `queue-stamps-own-rows.test.js` | Pins that queue markCompleted/markFailed stamp lifecycle columns and events only on grounded-path rows, not free-form |
| `requeue-grounded.test.js` | Pins that stale recovery re-queues a grounded request with its curriculum row so the worker renders it grounded |
| `share-path.test.js` | Pins portal 'Send on WhatsApp' share: a delivered LP leaves a niete_portal_share lifecycle row; answer keys/papers don't |
| `stale-recovery-limit.test.js` | Pins stale-request recovery giving up at the shared attempt limit: teacher told and request failed, else re-queued |
| `v8-ab-group.test.js` | Pins grade 1-5 A/B group A with no August version: nothing sent, one FAILED NOT_ELIGIBLE lifecycle row |
| `v8-path.test.js` | Pins grade 1-5 v8 LP lifecycle rows: download/plan rows carry request_id when switched on, unchanged when off |
| `v8-portal-path.test.js` | Pins v8 LP handed to the portal/teacher app: completed portal row, NO_ASSET failure, unknown lesson id writes nothing |
| `vocabulary.test.js` | Pins lifecycle source/status vocabularies in code equal migration V1.6.4 CHECK constraints and reference schema |
| `writer.test.js` | Pins Lifecycle.recordOutcome and LP_LIFECYCLE_PATHS switch: no DB call when off, warns on unknown paths, row shape |

## Who reads this (all, generated)
- env `LP_LIFECYCLE_PATHS` read at `tests/lesson-plan-lifecycle/health-route.test.js:62:4a6f98e9` · `tests/lesson-plan-lifecycle/health-worker-wiring.test.js:29:4a6f98e9`
- env `WORKER_QUEUES` read at `tests/lesson-plan-lifecycle/health-worker-wiring.test.js:28:e4d8257a`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/workers/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/lesson-plan-lifecycle/CLAUDE.index.md`? · `tests/lesson-plan-lifecycle/CLAUDE.md`?
