# database — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/database -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 1 files: 0 test + 1 support) |
| `bot-helpers.js` | User and session helpers: getOrCreateUser (race-safe on 23505), sessions, conversation rows used by all handlers |
| `queries.js` | Analytics queries (users, voice notes, messages, activity) backing the legacy admin dashboard |
| `schema.sql` | Original v3.0 Rumi bot Postgres schema (Nov 2025: users, conversations, sessions); historical baseline only |

## Who reads this (all, generated)
- `bot-helpers.js` ← imported by `bot/shared/handlers/image-message.handler.js:29:8c13c01b` · `bot/shared/handlers/lesson-plan-v2.handler.js:32:a8aa6ee7` · `bot/shared/handlers/text-message.handler.js:78:5a7073b3` · `bot/shared/handlers/voice-message.handler.js:32:5a7073b3` (+9: `python3 kg/kg.py who-reads bot-helpers.js`)
- `queries.js` ← imported by `bot/dashboard/index.js:21:f5ec6196`
- column `chat_sessions.created_at` (written by `bot-helpers.js`) ← read by `bot/scripts/send-outage-broadcast.js:65:4fbad16f`
- column `chat_sessions.last_activity_at` (written by `bot-helpers.js`) ← read by `bot/shared/services/quiz/quiz-delivery.service.js:441:4d0d3e6d` · `dashboard/database/queries.js:767:12f97444`
- column `chat_sessions.message_count` (written by `bot-helpers.js`) ← read by `dashboard/services/wordcloud.service.js:201:084eed49`
- column `chat_sessions.started_at` (written by `bot-helpers.js`) ← read by `dashboard/database/queries.js:711:f224db97`
- column `chat_sessions.user_id` (written by `bot-helpers.js`) ← read by `bot/shared/services/quiz/quiz-delivery.service.js:440:a819c701` · `bot/scripts/send-outage-broadcast.js:64:aa3d7725`
- column `conversations.content` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:91:8c49f695` · `bot/shared/services/lp-delivery-marker.service.js:59:19abc432` · `dashboard/services/wordcloud.service.js:65:5778b00e` · `bot/shared/database/queries.js:120:830013e4`
- column `conversations.created_at` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:91:8c49f695` · `bot/shared/services/coaching/weekly-report/reader.js:78:6d6e08aa` · `bot/shared/services/lp-delivery-marker.service.js:60:07cafb09` · `dashboard/database/queries.js:695:06c5e28d` (+4: `python3 kg/kg.py who-reads conversations.created_at`)
- column `conversations.id` (written by `schema.sql`) ← read by `bot/shared/services/lp-delivery-marker.service.js:56:c4cc30e2` · `bot/shared/database/queries.js:120:830013e4`
- column `conversations.message_type` (written by `schema.sql`) ← read by `dashboard/database/queries.js:703:94eac64b` · `bot/shared/database/queries.js:28:bd0e9309`
- column `conversations.role` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:91:8c49f695` · `bot/shared/services/coaching/weekly-report/reader.js:79:0ce3bb4a` · `bot/shared/services/lp-delivery-marker.service.js:58:704b3929` · `dashboard/database/queries.js:702:33d81df3` (+2: `python3 kg/kg.py who-reads conversations.role`)
- column `conversations.user_id` (written by `schema.sql`) ← read by `bot/shared/calls/call-tools.repo.js:92:9437903a` · `bot/shared/services/coaching/weekly-report/reader.js:79:0ce3bb4a` · `bot/shared/services/lp-delivery-marker.service.js:57:219f5683` · `bot/workers/stale-session.worker.js:260:219f5683` (+4: `python3 kg/kg.py who-reads conversations.user_id`)
- column `lesson_plans.content` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797`
- column `lesson_plans.created_at` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/context.service.js:143:e8356999` · `bot/shared/services/feature-linker.service.js:362:095556e4` · `bot/shared/services/first-touch/maker.prefill.js:107:033c2b21` (+7: `python3 kg/kg.py who-reads lesson_plans.created_at`)
- column `lesson_plans.gamma_url` (written by `bot-helpers.js`, `schema.sql`) ← read by `dashboard/routes/portal.routes.js:2609:bfdc3284` · `bot/shared/database/bot-helpers.js:412:5950c690`
- column `lesson_plans.grade` (written by `schema.sql`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` (+3: `python3 kg/kg.py who-reads lesson_plans.grade`)
- column `lesson_plans.id` (written by `schema.sql`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/lp-v8-delivery.service.js:316:046d673f` (+7: `python3 kg/kg.py who-reads lesson_plans.id`)
- column `lesson_plans.pdf_url` (written by `bot-helpers.js`) ← read by `dashboard/routes/portal.routes.js:2609:bfdc3284`
- column `lesson_plans.subject` (written by `schema.sql`) ← read by `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/first-touch/maker.prefill.js:106:a5945708` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:243:15e5b797` (+2: `python3 kg/kg.py who-reads lesson_plans.subject`)
- column `lesson_plans.topic` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:159:d69ad1fa` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:159:15e5b797` · `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `bot/shared/services/quiz/quiz-orchestrator.service.js:190:d69ad1fa` (+4: `python3 kg/kg.py who-reads lesson_plans.topic`)
- column `lesson_plans.type` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/services/lp-feedback.service.js:268:e461c55d` · `dashboard/database/queries.js:718:e125cbb9` · `dashboard/routes/portal.routes.js:2609:bfdc3284`
- column `lesson_plans.user_id` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:160:219f5683` · `bot/shared/services/context.service.js:142:219f5683` · `bot/shared/services/feature-linker.service.js:363:219f5683` · `bot/shared/services/feature-registration.service.js:136:9437903a` (+9: `python3 kg/kg.py who-reads lesson_plans.user_id`)
- column `schema_versions.version` (written by `schema.sql`) ← read by `infrastructure/scripts/migrate.js:91:9e9cfc5f`
- column `users.created_at` (written by `bot-helpers.js`, `schema.sql`) ← read by `dashboard/database/queries.js:688:06c5e28d` · `bot/shared/database/queries.js:106:fef21f32`
- column `users.id` (written by `schema.sql`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632` · `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` (+157: `python3 kg/kg.py who-reads users.id`)
- column `users.last_message_at` (written by `bot-helpers.js`) ← read by `bot/shared/services/nudges/lp-coaching-ask.service.js:361:46e676b4` · `bot/shared/services/nudges/topic-end-nudge.service.js:124:0fc5ff05` · `dashboard/database/queries.js:1557:8d804b7b` · `dashboard/index.js:3379:8d804b7b`
- column `users.name` (written by `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` · `bot/shared/routes/observe2-check-endpoint.js:295:c2c83a93` (+60: `python3 kg/kg.py who-reads users.name`)
- column `users.phone_number` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/routes/homework-request-endpoint.js:51:0b64c13f` · `bot/shared/routes/internal-fln-send.routes.js:45:9c6e16c1` · `bot/shared/routes/observe-mewaka-endpoint.js:97:0b64c13f` (+88: `python3 kg/kg.py who-reads users.phone_number`)
- column `users.registration_completed` (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/services/app-redirect.service.js:306:ae2bb76a` · `bot/shared/services/feature-registration.service.js:48:8579cb74` · `bot/shared/services/first-touch/teacher-home.data.js:67:67bade35` · `bot/shared/services/quiz/web-quiz-student-join.js:264:4a7f1445` (+4: `python3 kg/kg.py who-reads users.registration_completed`)
- column `users.registration_started_at` (written by `schema.sql`) ← read by `bot/shared/services/feature-registration.service.js:48:8579cb74` · `bot/shared/services/registration-invite.service.js:111:09d6775d`
- table `chat_sessions` whole row (`*`) (written by `bot-helpers.js`) ← read by `dashboard/database/queries.js:710:7a0c163a`?
- table `conversations` whole row (`*`) (written by `schema.sql`) ← read by `dashboard/database/queries.js:694:7a0c163a`? · `bot/shared/database/bot-helpers.js:309:d2b02c3e`?
- table `lesson_plans` whole row (`*`) (written by `bot-helpers.js`, `schema.sql`) ← read by `bot/shared/services/feature-registration.service.js:135:7a0c163a`? · `dashboard/database/queries.js:717:7a0c163a`?
- table `users` whole row (`*`) (written by `bot-helpers.js`, `schema.sql`) ← read by `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:314:d2b02c3e`? · `dashboard/test-rls-with-supabase-client.js:51:77bc023b`? · `bot/shared/database/bot-helpers.js:28:2ebcf687` (+1: `python3 kg/kg.py who-reads users`)
- table `chat_sessions` (written by `bot-helpers.js`) ← read by `bot/shared/services/quiz/quiz-delivery.service.js:438:7254e10d`? · `dashboard/database/queries.js:709:7254e10d`? · `dashboard/services/wordcloud.service.js:199:7254e10d`? · `bot/scripts/send-outage-broadcast.js:63:7254e10d`?
- table `chat_starts` (written by `bot-helpers.js`) ← read by `dashboard/database/queries.js:964:cf4c61b2`?
- table `conversations` (written by `bot-helpers.js`) ← read by `bot/shared/calls/call-tools.repo.js:90:69fe80c1`? · `bot/shared/services/coaching/weekly-report/reader.js:78:6d6e08aa`? · `bot/shared/services/lp-delivery-marker.service.js:55:2403bf55`? · `bot/workers/stale-session.worker.js:258:2403bf55`? (+4: `python3 kg/kg.py who-reads conversations`)
- table `lesson_plans` (written by `bot-helpers.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:158:611f2601`? · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:158:611f2601`? · `bot/shared/services/context.service.js:138:611f2601`? · `bot/shared/services/feature-linker.service.js:361:611f2601`? (+12: `python3 kg/kg.py who-reads lesson_plans`)
- table `schema_versions` (written by `schema.sql`) ← read by `infrastructure/scripts/migrate.js:90:b151663b`? · `scripts/schema-ledger-audit.py:233:da94d967`?
- table `users` (written by `bot-helpers.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/handlers/flow-response.handler.js:543:e1438837`? (+170: `python3 kg/kg.py who-reads users`)

## Tests (all, generated)
- `bot-helpers.js` ← `bot/tests/first-touch/first-reply-english.text-turn.test.js` · `bot/tests/first-touch/one-door-share-ref.test.js` · `bot/tests/quiz/student-ingress.test.js` · `bot/tests/registration/bd-2447-register-command-sends-flow.test.js` · `bot/tests/unit/bot-helpers-lesson-plan.test.js` · `tests/conversation-state/intent-never-dropped.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/database/bot-helpers.js`)

## Related (all, generated)
- docs: `bot/shared/CLAUDE.md`? · `docs/data-standards.md`?
