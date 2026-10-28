# migrations — Hand-numbered SQL migrations for dashboard tables, RLS, functions and MVs
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/database/migrations kg=300ea2374107 gen=1762153b6025 overflow=124 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `025_fix_mv_dashboard_stats_refresh.sql` — latest numbered one; explains the CONCURRENTLY refresh failure
- `018_partner_rbac_system.sql` — partner RBAC/ABAC schema and RLS base
- `022_create_dashboard_materialized_views.sql` — the mv_* views the dashboard reads
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `001*` | 3 files; most used `001_create_funnel_tables.sql`: Creates website_visits, cta_clicks, chat_starts funnel tables (website to registration journey). |
| `002_add_user_funnel_columns.sql` | Adds source, session_id, first_message_at, registered_at to users plus indexes for funnel attribution. |
| `002_dashboard_users_rbac.sql` | Creates dashboard_users table (email, role, invite token) for dashboard role-based access control and invitations. |
| `007_retention_calculation_function.sql` | Defines calculate_retention() Postgres function returning weekly cohort retention rates by feature type. |
| … | 22 more → `CLAUDE.index.md` |

## Who reads this (generated)
- column `video_requests.id` (written by `013_create_video_requests_table.sql`) ← read by `bot/shared/services/context.service.js:323:8460890c` · `bot/shared/services/video/video-animation.service.js:363:df7f7cbf` (+7)
- table `dashboard_users` (written by `002_dashboard_users_rbac.sql`) ← read by `dashboard/index.js:559:36baffc0`? · `dashboard/middleware/auth.js:76:9a69d293`? (+7)
- column `video_requests.status` (written by `013_create_video_requests_table.sql`) ← read by `bot/shared/services/context.service.js:184:a69ef692` · `bot/shared/services/feature-registration.service.js:155:abb6a119` (+4)
- … 102 more → `CLAUDE.index.md`

## Never (human)
- Never give an MV a unique index on a constant expression; CONCURRENTLY needs columns (`025_fix_mv_dashboard_stats_refresh.sql:13`, bd-ri5o9.7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/database/CLAUDE.index.md`? · `dashboard/database/CLAUDE.md`? · `dashboard/database/migrations/CLAUDE.index.md`? · `dashboard/database/migrations/CLAUDE.md`?
