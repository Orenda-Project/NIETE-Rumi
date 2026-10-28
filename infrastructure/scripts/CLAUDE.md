# scripts — Operator scripts: migrate, fresh-DB bootstrap, connection test, staging env

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure/scripts kg=9ef94cf5b402 gen=3d1e9a71182a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `migrate.js` — applies pending V*.sql; refuses when the ledger is behind
- `bootstrap-db.js` — fresh install: schema, RLS, seed in order
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `staging/` | → (no door; 1 files) |
| `migrate.js` | MigrationRunner: applies pending V*.sql via exec_sql RPC using the schema_versions ledger; refuses a lagging ledger |
| `bootstrap-db.js` | DatabaseBootstrapper: applies 00_complete-schema, 01_rls-policies, 02_seed-data in order for a fresh install |
| `CLAUDE.md` | (unmapped) |
| `sync-from-internal.sh` | Generates a patch from the internal repo to the public platform repo using infrastructure/sync/manifest.json rules |
| `test-connections.js` | Connectivity check script for Supabase, Redis and other required services before running the bot |

## Who reads this (generated)
- table `schema_versions` (written by `migrate.js`) ← read by `scripts/schema-ledger-audit.py:233:da94d967`?
- env read here: `LLM_PROVIDER` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `REDIS_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
- migrate.js applies exactly one pending migration and stops if more are pending (migrate.js:26)
- sync-from-internal.sh takes its path mappings from infrastructure/sync/manifest.json (sync-from-internal.sh:30)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/setup/bootstrap-db.test.js` (bootstrap-db.js)
- `tests/setup/migrate.test.js` (migrate.js)
- `tests/setup/teacher-nudges-migration.test.js` (migrate.js)

## Related (generated)
- docs: `infrastructure/CLAUDE.index.md`? · `infrastructure/CLAUDE.md`? · `infrastructure/scripts/CLAUDE.md`? · `infrastructure/sync/CLAUDE.md`? · `infrastructure/sync/README.md`? · `tests/BASELINE.md`?
