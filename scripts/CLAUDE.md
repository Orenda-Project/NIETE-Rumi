# scripts — Operator tools: data migrations, backfills, Flow publishers, QA
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts kg=c871c917064e gen=3bedd80dcffe overflow=83 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `smoke-test.js` — pre-deploy load check of bot entry, workers and dashboard routes
- `migration_gate.sh` — proves a migration apply/re-apply/rollback on throwaway Postgres
- `migrate-schools.py` — template for dry-run-default, ref-asserting write scripts
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 14 sub-dirs, each with `CLAUDE.md` | `app-funnel/` · `assessment/` · `child-test/` · `ci/` · `data/` · `fln-pdf/` · `lib/` · `llm/` · `migrations/` · `ops/` · `predicates/` · `qa/` · `samples/` · `web-quiz/` |
| 1 sub-dirs without a door | `tests/` (12 tests) |
| `row-history-audit.js` | Pure JS mirror of the record_history trigger rules (watched columns, no-op writes, actor) so tests can pin them |
| … | 83 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `backfill-names-from-fde.js` (+5)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+221)
- table `app_settings` (written by `create-analytics-user.js` (+1)) ← read by `bot/shared/config/feature-flags.js:114:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? (+176)
- column `app_settings.key` (written by `create-analytics-user.js`) ← read by `bot/shared/config/feature-flags.js:116:b7610a0c` · `bot/shared/config/model-settings.js:162:19a9a79a` (+174)
- … 67 more → `CLAUDE.index.md`

## Never (human)
- Write to a DB without asserting its project ref first: a worktree .env can point at another DB (migrate-schools.py:72, bd-2536)
- Run migration files through psql in the gate; each goes via exec_sql like the runner (migration_gate.sh:8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/bd-o98ji-coach-directory-match.test.js` (seed-coach-directory.js)
- `scripts/dev-portal.test.sh`? (dev-portal.sh)
- … 17 more → `CLAUDE.index.md`

## Related (generated)
- docs: `.claude/CLAUDE.md`? · `.github/CONTRIBUTING.md`? · `CLAUDE.md`? · `REPORT.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/attendance-bigquery-sync.md`? (+6)
