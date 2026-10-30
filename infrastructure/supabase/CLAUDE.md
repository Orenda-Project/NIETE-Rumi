# supabase — Fresh-install SQL (schema, RLS, seed) and versioned migrations for NIETE Supabase
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure/supabase kg=130da880e46d gen=f0c8a7750eae overflow=976 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `migrations/` — V*.sql plus ROLLBACK_V*.sql pairs, applied in order
- `00_complete-schema.sql` — full v2.0.0 fresh-install schema; bootstrap-db.js runs 00, 01, 02
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `migrations/` | Versioned NIETE migrations V1.0.0 to V1.8.3; some carry a ROLLBACK_ file → `migrations/CLAUDE.md` |
| `00_complete-schema.sql` | Full fresh-install schema (v2.0.0, dumped from prod 2026-02-17): tables, functions, triggers; bootstrap-db.js step 1 |
| `01_rls-policies.sql` | Enables row level security and service-role policies on the platform tables; run after 00_complete-schema |
| `02_seed-data.sql` | Seeds reference data for a fresh install: WCPM/LCPM benchmarks and the region_features default |
| `verify-schema.sql` | Post-setup queries that each return a row only if an expected table exists; empty result means a missing table |

## Who reads this (generated)
- column `users.id` (written by `00_complete-schema.sql`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632` · `bot/shared/calls/call-context.repo.js:36:6776a642` (+160)
- column `app_settings.key` (written by `00_complete-schema.sql`) ← read by `bot/shared/config/feature-flags.js:94:b7610a0c` · `bot/shared/config/model-settings.js:162:19a9a79a` (+125)
- column `app_settings.value` (written by `00_complete-schema.sql`) ← read by `bot/shared/config/feature-flags.js:93:2cf61275` · `bot/shared/config/model-settings.js:162:19a9a79a` (+125)
- … 976 more → `CLAUDE.index.md`

## Never (human)
- Do not add BEGIN/COMMIT to a migration; exec_sql refuses transaction control (migrations/V1.8.0__coachip_insights.sql:20)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `ab-testing`? · `database-analysis`? · `feature-tracer`?
- docs: `.claude/qa/fixtures/whatsapp/niete/training-seed-plan.md`? · `.claude/skills/data-standards/reference/audit-report-format.md`? · `.claude/skills/database-analysis/reference/query-patterns.md`? · `SECURITY.md`? · `SETUP.md`? · `docs/agent-customization.md`? (+6)
