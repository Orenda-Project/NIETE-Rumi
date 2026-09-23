# infrastructure/ — Database & deploy (L1)

**Parent:** [../CLAUDE.md](../CLAUDE.md) · Supabase (Postgres) schema + deployment configs.

## Layout

| Path | What's there |
|------|--------------|
| `supabase/00_complete-schema.sql` | The single fresh-install artifact — 73 tables, functions, triggers, + an idempotent column-reconcile section at the end |
| `supabase/01_rls-policies.sql` | Row-level security policies |
| `supabase/02_seed-data.sql` | Reference data (reading benchmarks) + `region_features` default row (fail-open gating) |
| `supabase/migrations/V*.sql` | Versioned upgrades, tracked in `schema_versions` |
| `supabase/verify-schema.sql` | Sanity checks |
| `scripts/bootstrap-db.js` | **`npm run bootstrap:db`** — applies schema → RLS → seed in order (idempotent, stops on first error) |
| `scripts/migrate.js` | Applies the pending `V*.sql` migration via the `exec_sql` RPC and records it in `schema_versions`; refuses a backlog of more than one (`--apply-all-pending` overrides). `scripts/schema-ledger-audit.py` (repo root) reports, read-only, what each environment really has vs what is recorded |
| `scripts/test-connections.js` | `npm run validate:connections` |
| `railway/` | Deployment configs |

## Rules

- **Fresh install** = `npm run bootstrap:db` (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and an
  `exec_sql` function — see the script header). It is idempotent, so re-running is safe.
- **Schema is the source of truth, and CI enforces it both ways:** every `.from()` table and every `.rpc()`
  function the bot uses must exist here, every insert/select column must exist, and every table must be
  referenced somewhere. If you add a `.from('x')` / new column / new `.rpc()`, add it here or the
  `tests/setup/{schema,column}-completeness` + `table-usage-conformance` guards fail.
- **Adding a column to an existing table:** put it in the column-reconcile `ALTER … ADD COLUMN IF NOT EXISTS`
  section at the bottom (keeps fresh-install + re-run both correct), and keep the trailing `NOTIFY pgrst`
  last so PostgREST reloads the cache.
- **Region gating** lives in `region_features` (DB, fail-open) — not in code constants.
