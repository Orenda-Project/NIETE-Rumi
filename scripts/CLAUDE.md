# scripts — Operator tools: data migrations, backfills, Flow publishers, QA
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts kg=30f403488020 gen=705e163f21f1 overflow=63 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `smoke-test.js` — pre-deploy load check of bot entry, workers and dashboard routes
- `migration_gate.sh` — proves a migration apply/re-apply/rollback on throwaway Postgres
- `migrate-schools.py` — template for dry-run-default, ref-asserting write scripts
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 12 sub-dirs, each with `CLAUDE.md` | `app-funnel/` · `assessment/` · `child-test/` · `lib/` · `llm/` · `migrations/` · `ops/` · `predicates/` · `qa/` · `samples/` · `tests/` · `web-quiz/` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `row-history-audit.js` | Pure JS mirror of the record_history trigger rules (watched columns, no-op writes, actor) so tests can pin them |
| … | 36 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `backfill-names-from-fde.js` (+4)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- table `app_settings` (written by `create-analytics-user.js` (+1)) ← read by `bot/shared/config/feature-flags.js:92:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? (+124)
- column `app_settings.key` (written by `create-analytics-user.js`) ← read by `bot/shared/config/feature-flags.js:94:b7610a0c` · `bot/shared/config/model-settings.js:162:19a9a79a` (+122)
- … 16 more → `CLAUDE.index.md`

## Never (human)
- Write to a DB without asserting its project ref first: a worktree .env can point at another DB (migrate-schools.py:72, bd-2536)
- Run migration files through psql in the gate; each goes via exec_sql like the runner (migration_gate.sh:8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/bd-o98ji-coach-directory-match.test.js` (seed-coach-directory.js)
- `scripts/dev-portal.test.sh`? (dev-portal.sh)
- … 11 more → `CLAUDE.index.md`

## Related (generated)
- docs: `.claude/CLAUDE.md`? · `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `CLAUDE.md`? · `REPORT.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? (+37)
