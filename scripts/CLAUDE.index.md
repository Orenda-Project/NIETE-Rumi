# scripts — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=scripts -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `app-funnel/` | Teacher-app funnel report built from Axiom journey events → `app-funnel/CLAUDE.md` |
| `assessment/` | Assessment generator: ICT textbook import and offline quality evals → `assessment/CLAUDE.md` |
| `child-test/` | Child reading/maths test: scoring evals and sandbox simulation helpers → `child-test/CLAUDE.md` |
| `lib/` | Pure decision logic imported by the write scripts so judgement is testable → `lib/CLAUDE.md` |
| `llm/` | CLI to see and change which LLM model runs each job → `llm/CLAUDE.md` |
| `migrations/` | Hand-applied data and schema migrations, dated; mostly training-content seeds → `migrations/CLAUDE.md` |
| `ops/` | Operational probes against live infrastructure → `ops/CLAUDE.md` |
| `predicates/` | Reviewed SQL predicates that select accounts for bulk flagging → `predicates/CLAUDE.md` |
| `qa/` | E2E runners, QA impact check, hooks and the scheduled LaunchAgent → `qa/CLAUDE.md` |
| `samples/` | Authored sample data for rendering demo coaching reports → `samples/CLAUDE.md` |
| `tests/` | → (no door; 8 tests) |
| `web-quiz/` | Web quiz content loading, backfills and by-hand health runs → `web-quiz/CLAUDE.md` |
| `assessment-parity.sh` | Gate: assessment-feature files must be identical on origin/main and origin/sandbox; run before calling a fix done |
| `audit-reason-usage.js` | Read-only audit of how often coaches type a removal reason in leader_roster_audit.detail |
| `backfill-lp-fidelity-moves.js` | Batched upsert of offline LP move-lists into niete_lp_fidelity_moves; checks project ref, --dry-run (bd-wmfsp.3) |
| `backfill-names-from-fde.js` | Backfills users.name from the legacy FDE production DB by phone match for nameless users (bd-60092) |
| `backfill-progress-from-passes.py` | Inserts module-progress rows for each active module of a level where the teacher has a passed grand-quiz attempt |
| `backfill-school-id-from-roster.py` | Sets users.school_id from the coach roster for unlinked teachers; one transaction with audit rows, checks target first |
| `backfill-training-assignments.js` | Backfills teacher_training_assignments for registered teachers who never got one, via band derivation (bd-2672) |
| `backfill-training-certificates.py` | Creates deterministic training_certificates rows for imported passed grand-quiz attempts that lack one |
| `bigquery-steps-attendance-ddl.sql` | BigQuery DDL for the STEPS teacher-presence table that the nightly attendance-bigquery-export worker writes |
| `coachip_lock_harness.sh` | Starts throwaway Postgres 17 plus pgbouncer and runs the COACHIP run-lock jest test through the pooler |
| `create-analytics-user.js` | Creates or reuses an analytics-only portal account (phone or name login) with dry-run default and --commit (bd-s6qbts.5) |
| `data-standards-selftest.sh` | Self-test proving the data-standards warn/block hook behaviours (gated ops, word boundaries, opt-in block, config scope) |
| `data-standards-verify.sh` | CI check that the vendored data-standards skill matches its receipt; --update regenerates after upstream refresh |
| `dev-portal.sh` | Starts, refreshes and stops the local teacher+coach portal on a local DB of made-up data (up/down/status/refresh) |
| `dev-portal.test.sh` | Hermetic test that dev-portal follows its owning checkout's commits: refresh, locking, hook behaviour (bd-i56c2u) |
| `extract-isaps-crq-rubrics.py` | Parses I-SAPS Level 1 CRQ rubric tables out of partner .docx WordprocessingML into band descriptions (JSON) |
| `fix-pdf-in-audio-url.js` | Moves PDFs wrongly stored in training_modules.audio_url to source_media_url so those modules can be delivered |
| `flow-env-parity.sh` | Checks every *_FLOW_ID a Flow config declares is set on both Railway bot and sqs-worker services for an environment |
| `flow-probe.py` | Publishes one Flow screen alone and sends it with a captured payload to bisect client-side render failures |
| `fold-duplicate-leader-schools.sql` | psql script that merges duplicate coach-to-school rows (mis-typed EMIS) with backups, a data-driven plan and assertions |
| `import-legacy-taleemabad.py` | Imports 66 legacy TALEEMABAD courses as the separate 'NIETE Archive' provider for coach training (bd-s42dye.4) |
| `language-floor-flip.js` | Flips preferred_language en to ur for teachers who never chose, with snapshot, dry-run default and rollback |
| `load-analytics-lists.js` | Writes the FDE school list and RDF teacher populations into app_settings for dashboard analytics-lists to read |
| `lp612-menu-render-proof.js` | Proof: runs real lp612 chapter/segment builders on staging rows with a stubbed client to show rendered menus (bd-3uiev) |
| `mark-test-users.py` | Sets users.is_test_user from a reviewed SQL predicate plus allowlist; dry-run CSV, one transaction, prod needs go |
| `migrate-beacon-house-quizzes.py` | One-shot import of Beacon House module MCQs from fde_production into training_questions; idempotent |
| `migrate-beacon-house.py` | One-shot fork of Beacon House curriculum (levels, courses, modules) from legacy fde_production into NIETE tables |
| `migrate-coaching-observations.py` | One-time pull of fde_production coaching_* tables into nietemigrated_* tables for the leader dashboard (FEAT-061) |
| `migrate-exam-question-bank.py` | One-shot fork of TALEEMABAD exam questions into exam_question_bank and generation of exam-composer blueprints |
| `migrate-gb-from-rumi.py` | (unmapped) |
| `migrate-lesson-plans.py` | One-shot upsert of Oxbridge lesson plans from the legacy DB into lesson_plan_catalog keyed on source row |
| `migrate-schools.py` | Migrates schools and principals from fde_production, links teachers, backfills roles; dry-run default (bd-2533) |
| `migrate-teacher-training.py` | One-shot fork of TALEEMABAD training content (vendor, levels, courses, modules, quizzes, programs) from fde_production |
| `migrate-training-attempts.py` | Imports one year of historical grand-quiz attempts and MCQ answers from FDE into training_assessment_attempts/answers |
| `migrate-training-history.py` | Imports completed module completions from FDE into teacher_training_progress, matching users by uuid then phone |
| `migrate-users.py` | Imports eligible Taleemabad users (org 1, all six role types) into NIETE users with profile metadata in preferences |
| `migration_gate.sh` | Proves a migration on throwaway local Postgres through the runner's exec_sql path: apply, re-apply, rollback, re-apply |
| `publish-assessment-gen-flow.py` | Publishes the Assessment Generator Flow JSON to Meta as draft or published, or updates a draft by --flow-id |
| `publish-exam-generator-flow.py` | Publishes the Exam Generator Flow JSON to Meta's WhatsApp Cloud API as draft, published, or in-place update |
| `publish-pakistan-lp-flow.py` | Publishes the Pakistan LP Flow JSON (FEAT-059) to Meta; warns that replacing JSON on a published Flow reverts it |
| `publish-quiz-multi-flow.py` | Publishes the static Quiz Multi-Select Flow (no endpoint_uri) to Meta's WhatsApp Cloud API |
| `publish-student-join-flow.py` | Publishes the localized Student Join Flow v2 (navigate, no endpoint) as a new Flow; register-one-flow.js preferred |
| `publish-teacher-training-flow.py` | Publishes the Teacher Training Flow JSON (teacher-training-flow-v1) to Meta; shape copied from the assessment publisher |
| `publish-transcript-quiz-flow.py` | Publishes the endpoint-based Transcript Quiz Flow (/quiz menu) to Meta; --endpoint-uri required, strips underscore keys |
| `rehost-legacy-training-media.js` | Re-hosts legacy third-party training media to R2 so videos open inline instead of downloading (bd-2666) |
| `release-isaps-held-attempts.js` | Releases held I-SAPS CRQ results: re-scores, issues certificates; dry-run default, --apply, ref-checked (bd-s42dye.5) |
| `render-sample-hero-report.js` | Renders a hero coaching report PNG for one framework from authored sample data, offline with stubbed LLM by default |
| `render-sample-pdf-report.js` | Renders the FICO 5-page PDFKit fallback report from an authored sample, English or Urdu, bypassing the hero dispatch |
| `render-sample-report.js` | Regenerates the MEWAKA hero sample coaching report in docs/samples from hand-authored data, no DB or PII |
| `roster-class-timeline.js` | Read-only: prints one class's history via roster_class_timeline(uuid), printing the project ref first |
| `row-history-audit.js` | Pure JS mirror of the record_history trigger rules (watched columns, no-op writes, actor) so tests can pin them |
| `run-capstone-level-swap-repair.py` | Runner for the capstone swap-repair SQL: dry-run rolls back after a before/after view, --apply commits (bd-60011) |
| `schema-ledger-audit.py` | Read-only audit of which migrations are really applied vs recorded in schema_versions, per environment |
| `seed-coach-directory.js` | One-time resolution of the ICT coach roster to work emails into the coach directory; dry-run by default, --live writes |
| `set-organization.py` | Normalizes users.organization to niete in one REPEATABLE READ transaction; reviewed CSV, prod go and ref confirm needed |
| `smoke-test-training-flow.js` | Local smoke of the Teacher Training Flow endpoint INIT and data_exchange handlers, skipping Meta encryption |
| `smoke-test.js` | Startup smoke: requires bot entry, SQS workers and dashboard routes with placeholder env to catch load errors pre-deploy |
| `sync-rehosted-urls-to-staging.js` | Copies production's re-hosted R2 training media URLs into staging's DB (shared bucket, no byte copy) |
| `sync-training-from-fde.py` | Idempotent delta sync of legacy FDE training completions and quiz passes after the July snapshot (bd-2528) |
| `verify-capstone-level-mapping.py` | Invariant check that each training_grand_quizzes row sits on the same level as its legacy FDE source quiz (bd-60011) |
| `verify-partition-bd2102.js` | Proof-of-fix running partitionByVendor against a real multi-vendor teacher enrolment on live NIETE data (bd-2102) |
| `verify-training-media-inline.js` | Checks live response headers of every active training video are a real video type, not binary/octet-stream (bd-2666) |
| `verify-users-migration.py` | Parity check re-deriving eligible Taleemabad users and diffing them against NIETE users by normalized phone |

## Who reads this (all, generated)
- column `app_settings.key` (written by `create-analytics-user.js`) ← read by `bot/shared/config/feature-flags.js:94:b7610a0c` · `bot/shared/config/model-settings.js:162:19a9a79a` · `bot/shared/config/web-quiz-brand.js:127:110366bd` · `bot/shared/services/app-redirect.service.js:281:8f3e60a7` (+122: `python3 kg/kg.py who-reads app_settings.key`)
- column `app_settings.value` (written by `create-analytics-user.js`) ← read by `bot/shared/config/feature-flags.js:93:2cf61275` · `bot/shared/config/model-settings.js:162:19a9a79a` · `bot/shared/config/web-quiz-brand.js:127:110366bd` · `bot/shared/services/app-redirect.service.js:281:8f3e60a7` (+122: `python3 kg/kg.py who-reads app_settings.value`)
- column `training_modules.audio_url` (written by `fix-pdf-in-audio-url.js`) ← read by `bot/shared/services/training/content-delivery.service.js:247:393812ae` · `dashboard/routes/hcp.routes.js:614:4e5165b9` · `dashboard/routes/portal.routes.js:5085:08b11a5f` · `dashboard/services/training-library.service.js:175:f4746f5c`
- column `training_modules.source_media_url` (written by `fix-pdf-in-audio-url.js`) ← read by `bot/shared/services/training/content-delivery.service.js:247:393812ae` · `dashboard/routes/portal.routes.js:5085:08b11a5f` · `dashboard/services/training-library.service.js:175:f4746f5c` · `scripts/verify-training-media-inline.js:55:f6c5c963`
- column `users.name` (written by `backfill-names-from-fde.js`, `create-analytics-user.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` (+60: `python3 kg/kg.py who-reads users.name`)
- column `users.phone_number` (written by `create-analytics-user.js`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/routes/homework-request-endpoint.js:51:0b64c13f` · `bot/shared/routes/internal-fln-send.routes.js:45:9c6e16c1` (+88: `python3 kg/kg.py who-reads users.phone_number`)
- column `users.portal_activated` (written by `create-analytics-user.js`) ← read by `bot/shared/services/portal-invite.service.js:203:d17654ef` · `bot/shared/services/quiz/web-quiz-student-join.js:264:4a7f1445` · `dashboard/routes/portal.routes.js:407:af8b00f9` · `bot/scripts/deployment/get-portal-test-tokens.js:46:0cecdbb4`
- column `users.portal_password_hash` (written by `create-analytics-user.js`) ← read by `dashboard/routes/portal.routes.js:407:af8b00f9`
- column `users.role` (written by `create-analytics-user.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` · `bot/shared/routes/attendance-marking-endpoint.js:381:10ac4b67` · `bot/shared/routes/registration-endpoint.js:104:713d0c02` (+33: `python3 kg/kg.py who-reads users.role`)
- column `users.school_id` (written by `create-analytics-user.js`) ← read by `bot/shared/handlers/flow-response.handler.js:543:e1438837` · `bot/shared/routes/attendance-marking-endpoint.js:381:10ac4b67` · `bot/shared/routes/class-manager-endpoint.js:143:aa90cbd2` · `bot/shared/routes/internal-api.routes.js:893:aa90cbd2` (+26: `python3 kg/kg.py who-reads users.school_id`)
- table `users` whole row (`*`) (written by `backfill-names-from-fde.js`, `create-analytics-user.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:314:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `app_settings` (written by `create-analytics-user.js`, `load-analytics-lists.js`) ← read by `bot/shared/config/feature-flags.js:92:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? · `bot/shared/config/web-quiz-brand.js:127:110366bd`? · `bot/shared/services/app-redirect.service.js:280:8d5282ae`? (+124: `python3 kg/kg.py who-reads app_settings`)
- table `coach_directory` (written by `seed-coach-directory.js`) ← read by `bot/shared/services/observe/observe-calendar.service.js:51:d8b7d39b`?
- table `leader_schools` (written by `fold-duplicate-leader-schools.sql`) ← read by `bot/shared/calls/call-tools.repo.js:269:8704fd93`? · `bot/shared/handlers/observe-command.handler.js:51:bdb5dbab`? · `bot/shared/routes/roster-flow-endpoint.js:210:bdb5dbab`? · `bot/shared/services/child-test/app/app-api.service.js:92:7e334d3a`? (+13: `python3 kg/kg.py who-reads leader_schools`)
- table `leader_teachers` (written by `fold-duplicate-leader-schools.sql`) ← read by `bot/shared/routes/roster-flow-endpoint.js:243:4bf60e0b`? · `bot/shared/services/observe/observe-school-admin.service.js:248:d85551ca`?
- table `teacher_training_assignments` (written by `backfill-training-assignments.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1151:1d73b094`? · `bot/shared/services/training/band-selection.service.js:238:1d73b094`? · `bot/shared/services/training/capstone-delivery.service.js:269:1d73b094`? · `bot/shared/services/training/quiz-delivery.service.js:463:1d73b094`? (+2: `python3 kg/kg.py who-reads teacher_training_assignments`)
- table `training_modules` (written by `fix-pdf-in-audio-url.js`, `rehost-legacy-training-media.js`, `sync-rehosted-urls-to-staging.js`) ← read by `bot/shared/calls/call-context.repo.js:115:a5aff531`? · `bot/shared/routes/teacher-training-endpoint.js:845:3c67573c`? · `bot/shared/services/training/capstone-delivery.service.js:107:a5aff531`? · `bot/shared/services/training/certificate.service.js:221:efe9de07`? (+12: `python3 kg/kg.py who-reads training_modules`)
- table `users` (written by `backfill-names-from-fde.js`, `backfill-school-id-from-roster.py`, `create-analytics-user.js`, `mark-test-users.py`, `migrate-schools.py`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+173: `python3 kg/kg.py who-reads users`)
- env `BACKFILL_PROD_GO` read at `scripts/backfill-school-id-from-roster.py:300:15cf6021`
- env `CHROME_BIN` read at `scripts/render-sample-report.js:75:6d368b54`
- env `COACHIP_LOCK_BPORT` read at `scripts/coachip_lock_harness.sh:17:a34aa449`
- env `COACHIP_LOCK_PGPORT` read at `scripts/coachip_lock_harness.sh:16:c7155438`
- env `DATA` read at `scripts/dev-portal.sh:106:6180c07f`
- env `DEV_PORTAL_BUILD_CMD` read at `scripts/dev-portal.sh:66:30b8faeb`
- env `DEV_PORTAL_RUN` read at `scripts/dev-portal.sh:43:6176e9dd`
- env `FLOW_ENV_FILE` read at `scripts/publish-teacher-training-flow.py:32:e8100f0d`
- env `GB_MIGRATION_PROD_GO` read at `scripts/migrate-gb-from-rumi.py:313:0e0bfecc`
- env `LOCAL_DB_PG_PORT` read at `scripts/dev-portal.sh:45:1b81e5f1`
- env `MARK_PROD_GO` read at `scripts/mark-test-users.py:105:3f8f1283`
- env `MOVES_DIR` read at `scripts/backfill-lp-fidelity-moves.js:22:178478f2`
- env `NIETE_SUPABASE_URL` read at `scripts/backfill-lp-fidelity-moves.js:26:4420c28f`
- env `NODE_OPTIONS` read at `scripts/coachip_lock_harness.sh:49:4995b210`
- env `PGBIN` read at `scripts/coachip_lock_harness.sh:9:33852aac`
- env `PG_BIN` read at `scripts/migration_gate.sh:49:10715f27`
- env `PORTAL_PORT` read at `scripts/dev-portal.sh:44:08c48378`
- env `PORTAL_REBUILD` read at `scripts/dev-portal.sh:143:bcf5c861`
- env `R2_ACCESS_KEY_ID` read at `scripts/rehost-legacy-training-media.js:185:d6f2a7a2`
- env `R2_BUCKET_NAME` read at `scripts/rehost-legacy-training-media.js:93:906fedd0`
- env `R2_ENDPOINT` read at `scripts/rehost-legacy-training-media.js:183:2684789e`
- env `R2_SECRET_ACCESS_KEY` read at `scripts/rehost-legacy-training-media.js:186:5687c9ca`
- env `REDIS_URL` read at `scripts/language-floor-flip.js:349:4f5341dc`
- env `RUMI_SOURCE_DATABASE_URL` read at `scripts/migrate-gb-from-rumi.py:323:4ee19798`
- env `SANDBOX_REFRESH` read at `scripts/dev-portal.sh:108:8811d7b9`
- env `SET_ORG_PROD_GO` read at `scripts/set-organization.py:106:f8ebac71`
- env `SMOKE_MODULES` read at `scripts/smoke-test.js:176:d57b4a1b`
- env `SUPABASE_DB_HOST` read at `scripts/backfill-training-certificates.py:52:e375d013`
- env `SUPABASE_DB_PASSWORD` read at `scripts/backfill-progress-from-passes.py:38:53a9c869` · `scripts/backfill-training-certificates.py:59:53a9c869` · `scripts/migrate-training-attempts.py:59:53a9c869`
- env `SUPABASE_DB_PORT` read at `scripts/backfill-training-certificates.py:56:1aef44b4`
- env `SUPABASE_DB_USER` read at `scripts/backfill-training-certificates.py:53:4ccf9622`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `scripts/audit-reason-usage.js:16:a4b14f4f` · `scripts/backfill-names-from-fde.js:85:589e490a` · `scripts/backfill-training-assignments.js:117:71c64b05` · `scripts/fix-pdf-in-audio-url.js:71:914abf4e` · `scripts/load-analytics-lists.js:319:85a61ce8` · `scripts/lp612-menu-render-proof.js:18:a4b14f4f` · `scripts/migrate-training-history.py:33:f56ac703` · `scripts/rehost-legacy-training-media.js:321:914abf4e` · `scripts/release-isaps-held-attempts.js:97:f83f00fd` · `scripts/sync-training-from-fde.py:108:f56ac703` · `scripts/verify-training-media-inline.js:52:914abf4e`
- env `SUPABASE_URL` read at `scripts/audit-reason-usage.js:15:2a5ea60a` · `scripts/backfill-lp-fidelity-moves.js:26:4420c28f` · `scripts/backfill-names-from-fde.js:77:c2c6132b` · `scripts/backfill-progress-from-passes.py:32:9045c181` · `scripts/backfill-training-assignments.js:85:c2c6132b` · `scripts/backfill-training-certificates.py:51:9045c181` · `scripts/create-analytics-user.js:366:46117462` · `scripts/fix-pdf-in-audio-url.js:58:c2c6132b` · `scripts/language-floor-flip.js:282:52c6e47e` · `scripts/load-analytics-lists.js:313:46117462` · `scripts/lp612-menu-render-proof.js:17:2a5ea60a` · `scripts/migrate-training-attempts.py:53:9045c181` · `scripts/migrate-training-history.py:32:8eb89b08` · `scripts/rehost-legacy-training-media.js:124:621be126` · `scripts/release-isaps-held-attempts.js:96:c9c5c6c4` · `scripts/roster-class-timeline.js:37:2698c8b6` · `scripts/seed-coach-directory.js:192:46117462` · `scripts/sync-training-from-fde.py:107:8eb89b08` · `scripts/verify-training-media-inline.js:52:914abf4e`
- env `TALEEMABAD_DB_HOST` read at `scripts/backfill-names-from-fde.js:105:2c352f43` · `scripts/migrate-training-attempts.py:67:e09da5bb` · `scripts/migrate-training-history.py:93:e09da5bb` · `scripts/sync-training-from-fde.py:155:e09da5bb`
- env `TALEEMABAD_DB_NAME` read at `scripts/backfill-names-from-fde.js:107:75d9bef9` · `scripts/migrate-training-attempts.py:69:60831966` · `scripts/migrate-training-history.py:95:60831966` · `scripts/sync-training-from-fde.py:157:60831966`
- env `TALEEMABAD_DB_PASSWORD` read at `scripts/backfill-names-from-fde.js:109:b2e6fb14` · `scripts/migrate-training-attempts.py:71:1cdf842a` · `scripts/migrate-training-history.py:97:1cdf842a` · `scripts/sync-training-from-fde.py:159:1cdf842a`
- env `TALEEMABAD_DB_PORT` read at `scripts/backfill-names-from-fde.js:106:0335854e` · `scripts/migrate-training-attempts.py:68:95b5a56a` · `scripts/migrate-training-history.py:94:95b5a56a` · `scripts/sync-training-from-fde.py:156:95b5a56a`
- env `TALEEMABAD_DB_SCHEMA` read at `scripts/backfill-names-from-fde.js:113:2f7e751f`
- env `TALEEMABAD_DB_USER` read at `scripts/backfill-names-from-fde.js:108:023537f1` · `scripts/migrate-training-attempts.py:70:c87907a5` · `scripts/migrate-training-history.py:96:c87907a5` · `scripts/sync-training-from-fde.py:158:c87907a5`
- env `WEB_QUIZ_BASE_URL` read at `scripts/dev-portal.sh:62:b8191056`

## Tests (all, generated)
- `create-analytics-user.js` ← `tests/portal/analytics-account-not-in-broadcast.test.js` · `tests/portal/create-analytics-user.test.js`
- `dev-portal.sh` ← `scripts/dev-portal.test.sh`?
- `language-floor-flip.js` ← `tests/migrations/language-floor-flip.test.js`
- `load-analytics-lists.js` ← `tests/portal/load-analytics-lists.test.js`
- `release-isaps-held-attempts.js` ← `tests/training/bd-s42dye5-release-held-attempts.test.js`
- `row-history-audit.js` ← `tests/database/bd-60014-row-history-audit.test.js` · `tests/database/bd-60020-roster-history.test.js` · `tests/database/bd-a21ks-actor-ledger.test.js` · `tests/database/bd-rbtpr-ledger-gaps.test.js` · `tests/database/record-history-users-trigger.test.js`
- `seed-coach-directory.js` ← `bot/tests/observe/bd-o98ji-coach-directory-match.test.js`
- `smoke-test.js` ← `tests/scripts/smoke-test.test.js`?

## Related (all, generated)
- docs: `.claude/CLAUDE.md`? · `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `CLAUDE.md`? · `REPORT.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/attendance-bigquery-sync.md`? · `docs/data-standards.md`? · `docs/features/video-quiz.md`? · `docs/migration/02-teacher-training.md`? · `docs/migration/04-data-migration.md`? · `docs/migration/05-exam-generator.md`?
