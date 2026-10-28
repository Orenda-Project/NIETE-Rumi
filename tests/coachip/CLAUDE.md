# coachip — COACHIP coach/RM insight routes tested over HTTP against a throwaway Postgres
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coachip kg=50bf0c6f11c2 gen=cba7342e1e19 overflow=4 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `coachip-contract.test.js` — every route in fixtures/routes.json: 401, 404, switch-off behaviour
- `helpers/pg-harness.js` — starts per-file Postgres; needs PG_BIN or initdb, else suites skip
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/coachip --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__golden__/` | → (no door; 1 test files) |
| `fixtures/` | → (no door; 2 test files) |
| `helpers/` | Shared helpers for COACHIP tests: temp Postgres, app mount, fictional seed rows → `helpers/CLAUDE.md` |
| `coachip*` | 13 files; most used `coachip-golden.test.js`: bd-sex15q.13: B7 golden route shapes of existing portal routes with no COACHIP setting; UPDATE_GOLDEN=1 regenerates |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- table `users` (written by `coachip-scope.service.test.js` (+1)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- table `app_settings` (written by `coachip-contract.test.js`) ← read by `bot/shared/config/feature-flags.js:92:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? (+124)
- table `coaching_sessions` (written by `coachip-scope.service.test.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- No forbidden key or URL may leave a COACHIP body; the wrapper answers 500 (tests/coachip/coachip-assert-clean.test.js:66)
- Mount test executes the index.js block, never greps it (tests/coachip/coachip-mount.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/lib/insights/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? (+4)
