# insights — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/tests/insights -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 5 files: 0 test + 5 support) |
| `circle.service.test.js` | Tests pickCircle in insights/circle: coachip_circle_items rows and one top-ranked missing moment per coach |
| `clip-stage.service.test.js` | Tests insights/clip-stage: source URL forms, a 300 s presigned cut, upload under the CHECKed key |
| `clips.service.test.js` | Tests clipKey (insights/clips): output matches the coachip_moments CHECK and anything the CHECK would refuse is refused |
| `env.service.test.js` | Tests assertEnvironment and the read-only client (insights/env): prod-shaped DB URL without --dry-run exits 3 |
| `facts.service.test.js` | Tests the CoachIP allow-list reader (insights/facts): a Proxy proves forbidden analysis_data keys are never read |
| `gloss.service.test.js` | Tests buildGlossInput (insights/gloss): only the prompt's keys, never evidence, quote or name fields (Proxy-checked) |
| `job.service.test.js` | Tests the nightly CoachIP job (insights/job): read-only dry run, writes no DB row, emits codes and counts only |
| `legs.service.test.js` | Tests minutesOverPlan and the W-IP-TIME median (insights/legs) from explain/guided move stamps |
| `model-concurrency.service.test.js` | bd-sex15q.43: tests COACHIP_MODEL_CONCURRENCY so at most N model calls are in flight and the spend ledger holds |
| `model-stage.gloss-reuse.service.test.js` | bd-sex15q.40: tests model-stage storing a re-glossed moment when its gloss call and re-check are reused |
| `model-stage.phonics-reuse.service.test.js` | bd-sex15q.39: tests model-stage when a phonics call is reused from an earlier night: stored ok, second night survives |
| `model.service.test.js` | Tests the model spend ledger and cap (insights/model): canStart rule, later calls refused, unknown analysis refused |
| `moments.service.test.js` | Tests buildMoments (insights/moments): the M rule per moment kind, asserting the coachip_moments CHECKs on every row |
| `night-safety.service.test.js` | bd-sex15q.41: tests nightly safety: heavy reads from the replica, bounded in-flight requests, timeouts, GET retries |
| `phonics.service.test.js` | Tests buildPhonicsInput (insights/phonics): transcript quote matching after normalisation and at_s from its line |
| `purge.service.test.js` | bd-sex15q.36: tests --purge-clips retention in insights/purge, a year after the last window that showed the clip |
| `ranking.service.test.js` | Tests intervention ranking (insights/ranking): prevalence x weight product, top two ranked, sector-share thresholds |
| `reconcile.service.test.js` | Tests reconcile (insights/reconcile): one row per phase in plan order and hand-counted skipped/graded counts |
| `results.service.test.js` | Tests buildResultCells (insights/results): W-LN letter-name rule, tested floor, below-bar logic for child results |
| `rollups.service.test.js` | Tests rollups (insights/rollups): every row passes the SQL CHECKs; 4/8-week denominators; shared schools counted once |
| `run-lock-pooler.service.test.js` | bd-sex15q.19: tests the CoachIP run lock behind pgbouncer transaction pooling (needs scripts/coachip_lock_harness.sh) |
| `run-lock.service.test.js` | bd-sex15q.19: unit tests acquireLock statements: transaction-scoped lock only, release ends the transaction |
| `scheduler.service.test.js` | Tests the 02:00 PKT scheduler in insights/scheduler: off by default, msUntilNextRun arithmetic, child process |
| `seed.service.test.js` | Tests buildSeedRows (insights/seed): 30 weaknesses, 77 interventions, crosswalk rows, parents before children |
| `signals.service.test.js` | Tests signal evaluators (insights/signals): each seeded primary crosswalk row has an evaluator or is out of scope |
| `source.service.test.js` | Tests teacherKey (insights/source): HMAC-SHA256 keyed id; short secret or missing id yields null, never an unkeyed hash |
| `windows.service.test.js` | Tests windowFor (insights/windows): Monday-rolled 4 or 8 week windows; bad date or week count throws |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `dashboard/data/coachip/CLAUDE.md`? · `dashboard/lib/insights/CLAUDE.md`? · `dashboard/tests/CLAUDE.md`?
