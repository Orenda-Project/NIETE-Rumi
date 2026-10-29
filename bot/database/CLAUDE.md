# database — Legacy v3.0 schema, guides and ad-hoc SQL migrations from the main-bot era
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/database kg=b38cbeee2ecf gen=84144a7d1981 overflow=21 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `migrations/web_quiz_challenge_registry.sql` — requires:/rollback-pair header style; apply sandbox first
- `schema.sql` — v3.0 base schema (Nov 2025); stale, current truth is supabase/baseline/schema.sql
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `migrations/` | Hand-applied SQL migrations (no runner); newer ones carry a *_rollback.sql file → `migrations/CLAUDE.md` |
| `schema.sql` | Original v3.0 Rumi base schema (users, conversations, audio_sessions and more); stale vs the numbered migrations |
| `SCHEMA_GUIDE.md` | Plain-language guide to the core Rumi tables for non-technical readers; v3.0 Nov 2025, older than the migrations |
| `SESSION_MIGRATION_GUIDE.md` | How-to for the v3.1.0 chat_sessions migration (30-minute session timeout); historical Nov 2025 rollout note |

## Who reads this (generated)
- column `users.id` (written by `schema.sql`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632` · `bot/shared/calls/call-context.repo.js:36:6776a642` (+159)
- column `users.phone_number` (written by `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` (+90)
- column `users.name` (written by `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` (+62)
- column `lesson_plans.user_id` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:413:219f5683` · `bot/shared/routes/quiz-flow-endpoint.js:160:219f5683` (+11)
- column `lesson_plans.created_at` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` (+9)
- … 21 more → `CLAUDE.index.md`

## Never (human)
- Do not treat schema.sql or SCHEMA_GUIDE.md as the live schema (header says v3.0, Nov 2025; baseline dump is 2026-10-14, supabase/baseline/schema.sql:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.md`? · `docs/data-standards.md`?
