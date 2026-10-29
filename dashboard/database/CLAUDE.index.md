# database — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/database -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `migrations/` | Hand-numbered SQL migrations for dashboard tables, RLS, functions and MVs → `migrations/CLAUDE.md` |
| `README.md` | How to run and create SQL migrations with run-sql-migration.js; tool overview for the dashboard DB folder. |
| `apply-user-columns-migration.md` | Manual steps to add funnel columns (source, session_id, first_message_at, registered_at) to users in Supabase. |
| `queries.js` | Big analytics query layer for the admin dashboard (users, stats, retention, MV reads) taking req.dbClient for RLS. |
| `run-sql-migration.js` | CLI that runs one SQL migration file against the database via pg; used per database/README.md. |
| `verify-funnel-migration.js` | Script that checks funnel tables and users funnel columns exist after the funnel migration. |

## Who reads this (all, generated)
- `queries.js` ← imported by `dashboard/index.js:48:4830149d` · `dashboard/services/whatsapp-broadcast.service.js:12:dfc14022`
- column `broadcast_messages.broadcast_id` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:158:94ad840a`
- column `broadcast_messages.message_id` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:159:8d350454`
- column `broadcast_messages.sent_at` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:417:dcdfb840`
- column `broadcast_messages.status` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:158:94ad840a`
- column `broadcast_messages.user_id` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:414:219f5683`
- table `broadcast_messages` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:157:5e6ab800`?
- env `SUPABASE_SERVICE_ROLE_KEY` read at `dashboard/database/verify-funnel-migration.js:7:90118d4a`
- env `SUPABASE_URL` read at `dashboard/database/verify-funnel-migration.js:6:e84bc099`

## Tests (all, generated)
- `queries.js` ← `tests/broadcast/bd-1zyqf-broadcast-language.test.js` · `tests/broadcast/bd-djbrt-direct-send-records-wamid.test.js` · `tests/broadcast/bd-ikkpf-search-mode-registration-flag.test.js` · `tests/broadcast/bd-x4njf-approved-template.test.js` · `tests/portal/analytics-account-not-in-broadcast.test.js`

## Related (all, generated)
- docs: `dashboard/CLAUDE.md`?
