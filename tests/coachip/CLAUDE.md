# coachip — COACHIP coach/RM insight routes tested over HTTP against a throwaway Postgres
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coachip kg=a939964a7464 gen=15d25e590d30 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `coachip-contract.test.js` — every route in fixtures/routes.json: 401, 404, switch-off behaviour
- `helpers/pg-harness.js` — starts per-file Postgres; needs PG_BIN or initdb, else suites skip
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/coachip --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__golden__/` | → (no door; 1 files: 0 test + 1 support) |
| `fixtures/` | → (no door; 2 files: 0 test + 2 support) |
| `helpers/` | Shared helpers for COACHIP tests: temp Postgres, app mount, fictional seed rows → `helpers/CLAUDE.md` |
| `coachip*` | 13 files; most used `coachip-golden.test.js`: bd-sex15q.13: B7 golden route shapes of existing portal routes with no COACHIP setting; UPDATE_GOLDEN=1 regenerates |

## Who reads this (generated)
- (none)

## Never (human)
- No forbidden key or URL may leave a COACHIP body; the wrapper answers 500 (tests/coachip/coachip-assert-clean.test.js:66)
- Mount test executes the index.js block, never greps it (tests/coachip/coachip-mount.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/routes/CLAUDE.md`? · `tests/CLAUDE.md`?
