# database — DB layer: analytics queries and ad-hoc SQL migration runner
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/database kg=9d99e2b75a05 gen=0cda0fa104bf overflow=8 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `queries.js` — all admin analytics queries; first arg is the RLS dbClient
- `run-sql-migration.js` — run a migration file: node database/run-sql-migration.js <file>
- `README.md` — migration workflow
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `migrations/` | Hand-numbered SQL migrations for dashboard tables, RLS, functions and MVs → `migrations/CLAUDE.md` |
| `queries.js` | Big analytics query layer for the admin dashboard (users, stats, retention, MV reads) taking req.dbClient for RLS. |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `README.md` | How to run and create SQL migrations with run-sql-migration.js; tool overview for the dashboard DB folder. |
| `apply-user-columns-migration.md` | Manual steps to add funnel columns (source, session_id, first_message_at, registered_at) to users in Supabase. |
| `run-sql-migration.js` | CLI that runs one SQL migration file against the database via pg; used per database/README.md. |
| … | 1 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `queries.js` ← imported by `dashboard/index.js:48:4830149d` · `dashboard/services/whatsapp-broadcast.service.js:12:dfc14022`
- column `broadcast_messages.broadcast_id` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:158:94ad840a`
- column `broadcast_messages.message_id` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:159:8d350454`
- column `broadcast_messages.sent_at` (written by `queries.js`) ← read by `bot/whatsapp-bot.js:417:dcdfb840`
- … 4 more → `CLAUDE.index.md`

## Never (human)
- Never query admin data without the request's RLS dbClient (`queries.js:5`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/broadcast/bd-1zyqf-broadcast-language.test.js` (queries.js)
- `tests/broadcast/bd-djbrt-direct-send-records-wamid.test.js` (queries.js)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/database/CLAUDE.index.md`? · `dashboard/database/CLAUDE.md`? · `dashboard/database/README.md`? · `dashboard/database/apply-user-columns-migration.md`? (+5)
