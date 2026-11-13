# supabase — Fresh-install SQL (schema, RLS, seed) and versioned migrations for NIETE Supabase
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure/supabase kg=b571b0d3c014 gen=6ca90c59d092 overflow=1001 rendered=2026-11-09 kg.py=1.1.0 -->

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
| … | 1 more → `CLAUDE.index.md` |

## Who reads this (generated)
- column `users.id` (written by `00_complete-schema.sql`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632` · `bot/shared/calls/call-context.repo.js:36:6776a642` (+175)
- column `app_settings.key` (written by `00_complete-schema.sql`) ← read by `bot/shared/config/feature-flags.js:102:b7610a0c` · `bot/shared/config/model-settings.js:162:19a9a79a` (+127)
- … 1000 more → `CLAUDE.index.md`

## Never (human)
- Do not add BEGIN/COMMIT to a migration; exec_sql refuses transaction control (migrations/V1.8.0__coachip_insights.sql:20)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `ab-testing`? · `database-analysis`? · `feature-tracer`?
- docs: `.claude/qa/fixtures/whatsapp/niete/training-seed-plan.md`? · `.claude/skills/data-standards/reference/audit-report-format.md`? · `.claude/skills/database-analysis/reference/query-patterns.md`? · `SECURITY.md`? · `SETUP.md`? · `docs/agent-customization.md`? (+6)
