# lesson-plan-lifecycle — lesson_plan_requests lifecycle rows per LP path, plus the hourly health check
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/lesson-plan-lifecycle kg=45d94e14d10a gen=e7812b2cbca6 overflow=11 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `writer.test.js` — Lifecycle.recordOutcome and the LP_LIFECYCLE_PATHS switch; start here
- `vocabulary.test.js` — code vocabularies must equal migration V1.6.4 CHECKs and the reference schema
- Covers every path (v8, grounded, 6-12, homework, share) and health. Root jest (tests/jest.config.js): from repo root `node tests/run.js tests/lesson-plan-lifecycle --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `helpers/` | → (no door; 1 test files) |
| `grounded-path.test.js` | Pins grounded (curriculum) LP lifecycle columns written only when switched on, incl. SQS enqueue failure handling |
| `lp612*` | 3 files; most used `lp612-leader.test.js`: bd-4joiqz: pins that a portal LEADER's grade 6-12 ask writes a claim but no lifecycle row; a teacher's still does |
| `CLAUDE.index.md` | (unmapped) |
| `requeue-grounded.test.js` | Pins that stale recovery re-queues a grounded request with its curriculum row so the worker renders it grounded |
| `v8*` | 3 files; most used `v8-portal-path.test.js`: Pins v8 LP handed to the portal/teacher app: completed portal row, NO_ASSET failure, unknown lesson id writes nothing |
| `CLAUDE.md` | (unmapped) |
| `generation-failed-attempts.test.js` | Pins lesson_plan.generation.failed attempt number and final flag across SQS retries (limit 3) in the generation worker |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `LP_LIFECYCLE_PATHS` · `WORKER_QUEUES`

## Never (human)
- Switched OFF must make no DB call and leave old writes untouched (writer.test.js:117)
- Keep code vocabularies and the V1.6.4 CHECK constraints one list; drift silently drops the record (vocabulary.test.js:1-10)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.index.md`? (+6)
