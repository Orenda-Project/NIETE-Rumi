# database — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/database -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `migrations/` | Hand-applied SQL migrations (no runner); newer ones carry a *_rollback.sql file → `migrations/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `SCHEMA_GUIDE.md` | Plain-language guide to the core Rumi tables for non-technical readers; v3.0 Nov 2025, older than the migrations |
| `SESSION_MIGRATION_GUIDE.md` | How-to for the v3.1.0 chat_sessions migration (30-minute session timeout); historical Nov 2025 rollout note |
| `schema.sql` | Original v3.0 Rumi base schema (users, conversations, audio_sessions and more); stale vs the numbered migrations |

## Who reads this (all, generated)
- column `conversations.content` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:91:8c49f695` · `bot/shared/database/queries.js:120:830013e4` · `bot/shared/services/lp-delivery-marker.service.js:59:19abc432` · `dashboard/services/wordcloud.service.js:65:5778b00e`
- column `conversations.created_at` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:91:8c49f695` · `bot/shared/database/bot-helpers.js:311:e8356999` · `bot/shared/database/queries.js:71:324e62ac` · `bot/shared/services/coaching/weekly-report/reader.js:78:6d6e08aa` (+4: `python3 kg/kg.py who-reads conversations.created_at`)
- column `conversations.id` (written by `schema.sql`) ← read by `bot/shared/database/queries.js:120:830013e4` · `bot/shared/services/lp-delivery-marker.service.js:56:c4cc30e2`
- column `conversations.message_type` (written by `schema.sql`) ← read by `bot/shared/database/queries.js:28:bd0e9309` · `dashboard/database/queries.js:703:94eac64b`
- column `conversations.role` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:91:8c49f695` · `bot/shared/database/queries.js:27:33d81df3` · `bot/shared/services/coaching/weekly-report/reader.js:79:0ce3bb4a` · `bot/shared/services/lp-delivery-marker.service.js:58:704b3929` (+2: `python3 kg/kg.py who-reads conversations.role`)
- column `conversations.user_id` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:92:9437903a` · `bot/shared/database/bot-helpers.js:310:219f5683` · `bot/shared/database/queries.js:69:aa3d7725` · `bot/shared/services/coaching/weekly-report/reader.js:79:0ce3bb4a` (+4: `python3 kg/kg.py who-reads conversations.user_id`)
- column `lesson_plans.content` (written by `schema.sql`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797`
- column `lesson_plans.created_at` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/context.service.js:143:e8356999` · `bot/shared/services/feature-linker.service.js:362:095556e4` (+7: `python3 kg/kg.py who-reads lesson_plans.created_at`)
- column `lesson_plans.gamma_url` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `dashboard/routes/portal.routes.js:2608:bfdc3284`
- column `lesson_plans.grade` (written by `schema.sql`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+3: `python3 kg/kg.py who-reads lesson_plans.grade`)
- column `lesson_plans.id` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+7: `python3 kg/kg.py who-reads lesson_plans.id`)
- column `lesson_plans.subject` (written by `schema.sql`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797` (+2: `python3 kg/kg.py who-reads lesson_plans.subject`)
- column `lesson_plans.topic` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:412:5950c690` · `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+4: `python3 kg/kg.py who-reads lesson_plans.topic`)
- column `lesson_plans.type` (written by `schema.sql`) ← read by `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `dashboard/database/queries.js:718:e125cbb9` · `dashboard/routes/portal.routes.js:2608:bfdc3284`
- column `lesson_plans.user_id` (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:413:219f5683` · `bot/shared/routes/quiz-flow-endpoint.js:160:219f5683` · `bot/shared/services/context.service.js:142:219f5683` · `bot/shared/services/feature-linker.service.js:363:219f5683` (+9: `python3 kg/kg.py who-reads lesson_plans.user_id`)
- column `schema_versions.version` (written by `schema.sql`) ← read by `infrastructure/scripts/migrate.js:91:9e9cfc5f`
- column `users.created_at` (written by `schema.sql`) ← read by `bot/shared/database/queries.js:106:fef21f32` · `dashboard/database/queries.js:688:06c5e28d`
- column `users.id` (written by `schema.sql`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632` · `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/database/bot-helpers.js:67:4da212da` (+155: `python3 kg/kg.py who-reads users.id`)
- column `users.name` (written by `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` (+60: `python3 kg/kg.py who-reads users.name`)
- column `users.phone_number` (written by `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/routes/homework-request-endpoint.js:51:0b64c13f` · `bot/shared/routes/internal-fln-send.routes.js:45:9c6e16c1` (+87: `python3 kg/kg.py who-reads users.phone_number`)
- column `users.registration_completed` (written by `schema.sql`) ← read by `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/services/app-redirect.service.js:306:ae2bb76a` · `bot/shared/services/feature-registration.service.js:48:8579cb74` · `bot/shared/services/first-touch/teacher-home.data.js:67:67bade35` (+4: `python3 kg/kg.py who-reads users.registration_completed`)
- column `users.registration_started_at` (written by `schema.sql`) ← read by `bot/shared/services/feature-registration.service.js:48:8579cb74` · `bot/shared/services/registration-invite.service.js:111:09d6775d`
- table `conversations` whole row (`*`) (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:309:d2b02c3e`? · `dashboard/database/queries.js:694:7a0c163a`?
- table `lesson_plans` whole row (`*`) (written by `schema.sql`) ← read by `bot/shared/services/feature-registration.service.js:135:7a0c163a`? · `dashboard/database/queries.js:717:7a0c163a`?
- table `users` whole row (`*`) (written by `schema.sql`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687` · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:313:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `schema_versions` (written by `schema.sql`) ← read by `infrastructure/scripts/migrate.js:90:b151663b`? · `scripts/schema-ledger-audit.py:233:da94d967`?

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/database/CLAUDE.index.md`? · `bot/database/CLAUDE.md`? · `bot/database/SCHEMA_GUIDE.md`? · `bot/database/SESSION_MIGRATION_GUIDE.md`? · `bot/database/migrations/CLAUDE.index.md`? · `bot/database/migrations/CLAUDE.md`? · `docs/data-standards.md`?
