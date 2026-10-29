# insights — Tests for the nightly CoachIP insights job: signals, rollups, ranking, model stage, locks
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests/insights kg=50ae949fbb4f gen=3b5b8b96ba6c overflow=16 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `job.service.test.js` — end-to-end run on a fictional tier; the best map of the stage chain
- `fixtures/analysis.js` — fictional analysis_data builders every test here shares
- Run: cd dashboard && ./run-tests.sh tests/insights --maxWorkers=2; run-lock-pooler skips without COACHIP_LOCK_*_URL
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 5 files: 0 test + 5 support) |
| `rollups.service.test.js` | Tests rollups (insights/rollups): every row passes the SQL CHECKs; 4/8-week denominators; shared schools counted once |
| `model*` | 4 files; most used `model-concurrency.service.test.js`: bd-sex15q.43: tests COACHIP_MODEL_CONCURRENCY so at most N model calls are in flight and the spend ledger holds |
| `job.service.test.js` | Tests the nightly CoachIP job (insights/job): read-only dry run, writes no DB row, emits codes and counts only |
| `purge.service.test.js` | bd-sex15q.36: tests --purge-clips retention in insights/purge, a year after the last window that showed the clip |
| `seed.service.test.js` | Tests buildSeedRows (insights/seed): 30 weaknesses, 77 interventions, crosswalk rows, parents before children |
| `signals.service.test.js` | Tests signal evaluators (insights/signals): each seeded primary crosswalk row has an evaluator or is out of scope |
| `facts.service.test.js` | Tests the CoachIP allow-list reader (insights/facts): a Proxy proves forbidden analysis_data keys are never read |
| `gloss.service.test.js` | Tests buildGlossInput (insights/gloss): only the prompt's keys, never evidence, quote or name fields (Proxy-checked) |
| … | 19 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- The job must never read a forbidden analysis_data key; tests wrap it in a Proxy (dashboard/tests/insights/job.service.test.js:45)
- A prod-shaped DB URL without --dry-run must exit 3 (dashboard/tests/insights/env.service.test.js:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/data/coachip/CLAUDE.md`? · `dashboard/lib/insights/CLAUDE.md`? · `dashboard/tests/CLAUDE.md`?
