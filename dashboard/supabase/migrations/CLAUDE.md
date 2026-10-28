# migrations — Supabase-CLI migrations: funnel tables (copies) and training_sync_runs ledger
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/supabase/migrations kg=5b42c87ddf31 gen=b1b3f570243f overflow=1 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `20260807_001_create_training_sync_runs.sql` — ledger deciding when the FDE sync can be retired
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `20260807_001_create_training_sync_runs.sql` | Creates the training_sync_runs ledger recording each FDE delta-sync run so the sync can be retired on evidence; bd-2528. |
| `20251107_001_create_funnel_tables.sql` | Byte-identical copy of database/migrations/001_create_funnel_tables.sql (website_visits, cta_clicks, chat_starts). |
| `20251107_002_add_user_funnel_columns.sql` | Byte-identical copy of database/migrations/002_add_user_funnel_columns.sql (users funnel columns). |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- table `users` whole row (`*`) (written by `20251107_001_create_funnel_tables.sql` (+1)) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? (+3)
- column `users.first_message_at` (written by `20251107_001_create_funnel_tables.sql` (+1)) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `users.registered_at` (written by `20251107_001_create_funnel_tables.sql` (+1)) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `users.session_id` (written by `20251107_001_create_funnel_tables.sql` (+1)) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `users.source` (written by `20251107_001_create_funnel_tables.sql` (+1)) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `website_visits.id` (written by `20251107_001_create_funnel_tables.sql`) ← read by `dashboard/routes/funnel-tracking.routes.js:84:c4cc30e2`
- … 1 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/supabase/CLAUDE.md`? · `dashboard/supabase/migrations/CLAUDE.index.md`? · `dashboard/supabase/migrations/CLAUDE.md`?
