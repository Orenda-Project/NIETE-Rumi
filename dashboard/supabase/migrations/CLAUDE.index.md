# migrations — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/supabase/migrations -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `20251107_001_create_funnel_tables.sql` | Byte-identical copy of database/migrations/001_create_funnel_tables.sql (website_visits, cta_clicks, chat_starts). |
| `20251107_002_add_user_funnel_columns.sql` | Byte-identical copy of database/migrations/002_add_user_funnel_columns.sql (users funnel columns). |
| `20260807_001_create_training_sync_runs.sql` | Creates the training_sync_runs ledger recording each FDE delta-sync run so the sync can be retired on evidence; bd-2528. |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (all, generated)
- column `users.first_message_at` (written by `20251107_001_create_funnel_tables.sql`, `20251107_002_add_user_funnel_columns.sql`) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `users.registered_at` (written by `20251107_001_create_funnel_tables.sql`, `20251107_002_add_user_funnel_columns.sql`) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `users.session_id` (written by `20251107_001_create_funnel_tables.sql`, `20251107_002_add_user_funnel_columns.sql`) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `users.source` (written by `20251107_001_create_funnel_tables.sql`, `20251107_002_add_user_funnel_columns.sql`) ← read by `dashboard/database/verify-funnel-migration.js:50:680bf0db`
- column `website_visits.id` (written by `20251107_001_create_funnel_tables.sql`) ← read by `dashboard/routes/funnel-tracking.routes.js:84:c4cc30e2`
- column `website_visits.session_id` (written by `20251107_001_create_funnel_tables.sql`) ← read by `dashboard/routes/funnel-tracking.routes.js:85:3a858213`
- table `users` whole row (`*`) (written by `20251107_001_create_funnel_tables.sql`, `20251107_002_add_user_funnel_columns.sql`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:313:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `dashboard/supabase/CLAUDE.md`? · `dashboard/supabase/migrations/CLAUDE.index.md`? · `dashboard/supabase/migrations/CLAUDE.md`?
