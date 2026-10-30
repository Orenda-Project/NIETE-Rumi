# scripts — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `assessment/` | Backfills for exam-paper versioning (edited_from families) → `assessment/CLAUDE.md` |
| `assets/` | Generate and upload Flow JSON and reading-passage background assets → `assets/CLAUDE.md` |
| `audit/` | Read-only audits of deployed configuration → `audit/CLAUDE.md` |
| `child-test/` | Print packs, SA battery bank build and SA voice recording for the child test → `child-test/CLAUDE.md` |
| `deployment/` | Reference Meta Graph API scripts from the original Taleemabad WABA; ids are WABA-bound → `deployment/CLAUDE.md` |
| `docs/` | Setup guides for optional AWS SQS and Railway Redis infrastructure → `docs/CLAUDE.md` |
| `e2e/` | The local mock E2E lane: fake Graph API, local Postgres, local R2, stack scripts → `e2e/CLAUDE.md` |
| `load/` | Offline load harness for the quiz queue → `load/CLAUDE.md` |
| `migration/` | One-off NIETE migration appliers, lesson-plan imports and surveys → `migration/CLAUDE.md` |
| `onboarding/` | Upload of feature-introduction videos to R2 → `onboarding/CLAUDE.md` |
| `ops/` | One-shot operational fixes run by hand against live caches → `ops/CLAUDE.md` |
| `quiz/` | Quiz and Challenge audio, language and kept-reading maintenance scripts → `quiz/CLAUDE.md` |
| `render/` | Prototype LP renderers and Gamma-grounded LP smoke tests → `render/CLAUDE.md` |
| `setup/` | Register WhatsApp Flows, templates and encryption with Meta; doctor preflight → `setup/CLAUDE.md` |
| `templates/` | Menu carousel template creation and video upload; WABA-bound ids → `templates/CLAUDE.md` |
| `testing/` | Local chat and webhook simulators for manual testing → `testing/CLAUDE.md` |
| `video-reco/` | Builds the training-video catalogue for the recommender → `video-reco/CLAUDE.md` |
| `apply-lp-splits.js` | Applies data/lp_splits.json to committed lp_catalog.json on machines without the ingestion tree; --check is CI-friendly |
| `apply-lp612-figure-notes.js` | Additively writes the diagram-plan figure directive into each Grades 6-12 segment's notes (bd-17mht) |
| `apply-lp612-salutation-stamps.js` | Restores the salutation to eight Grades 6-12 menu titles that dropped it (bd-d6c8y, operator ruling 2026-09-23) |
| `assert-native-modules.js` | Postinstall guard: fails the install when optional native canvas did not install, keeping prior deploy live (bd-vq0mfv) |
| `backfill-lp-asset-sources.js` | Recovers slide script for lessons uploaded before it was kept; writes nothing without a proof |
| `backfill-section-b-retranscribe.js` | One-off: re-transcribes Section-B-blank observations from R2 audio and recomputes LP fidelity (bd-2kxxa.5) |
| `broadcast-fa-video.js` | (unmapped) |
| `build-lp-catalog.js` | Offline build of bot/data/lp_catalog.json from the K-5 ingestion tree; the LP Flow endpoint reads the output at runtime |
| `challenge-registry-seed.js` | Prints the SQL seed for the Challenge content registry (periods, Set A passages, maths items) from the banks |
| `challenge-stock-seed.js` | Prints idempotent SQL inserting one draft challenge_passages row per passage file; never releases or reviews a row |
| `check-balochi-history.js` | Ad-hoc Axiom APL query script checking recent Balochi-language activity over the last 7 days |
| `check-syntax.js` | Parses every tracked JS file so an unbootable entry file cannot reach a service (bd-wpx18, PR 1008 stray brace) |
| `debug-balochi.js` | Ad-hoc Axiom APL debugging script for Balochi-language message flow over the last 24 hours |
| `diagnose-calls-context.js` | Read-only diagnostic running the live call connect-context path to show what a call knows about a caller (bd-neeyat) |
| `exam-checker-annotate-demo.js` | Demo of the exam checker pipeline OCR to grade to annotated image; output goes to scripts/output |
| `exam-checker-dry-run.js` | Dry-run test of the exam checker OCR plus grading pipeline on a sample exam image |
| `export-lp612-segments.js` | Writes the live Grades 6-12 menu back out as corpus files, the first half of a video refresh before import-lp612-segmen… |
| `generate-child-test-check-flow-json.js` | Regenerates docs/flows/child-test-check.json from its generator; a contract test fails on drift |
| `generate-child-test-review-flow-json.js` | Regenerates docs/flows/child-test-review.json (end-of-visit review Flow) from its generator; a contract test fails on d… |
| `generate-coaching-excel.js` | Exports coaching sessions to an Excel sheet grouped by teacher with all observation data, for a coach |
| `generate-observe-flow-json.js` | Generates docs/flows/observe-mewaka-flow.json from the MEWAKA framework module (FEAT-053 bd-18) |
| `generate-observe2-flow-json.js` | Regenerates both /observe2 Flows (field form, evidence check) from their generators; contract tests catch drift |
| `import-assessment-topics.js` | Loads teacher topics from the G1-5 curriculum matrix CSVs into assessment_topics; supports dry-run and review CSV |
| `import-lp612-segments.js` | Loads the Grades 6-12 segmentation corpus JSONs into the serving menu; supports corpus version and dry-run |
| `ingest-lp-v9-html.js` | Ingests v9 K-5 lesson-plan HTMLs as the quiz source for the version served; guarded by --expect-ref, optional R2/DB app… |
| `lp-catalog-merge.js` | Merges separately built elective books into the committed lp_catalog.json, replacing same-stem books (bd-6640j.1.8) |
| `lp-catalog-splits.js` | Splits one catalog lesson into two teaching days; part 1 keeps lesson_id, part 2 gets id plus b |
| `lp612-overlay-backfill.js` | Entry point that runs the Grades 6-12 overlay repair pass through the backfill service (bd-vrt20) |
| `lp612-sidecar-audit.js` | Audits which cached 6-12 lessons lost their .lp.json sidecar document beside the PDF (bd-oak77.18) |
| `quiz-funnel-watch.js` | Dry-run of the quiz funnel watcher: prints the DM summary and due alerts for a window without posting or locking |
| `register-attendance-flows.js` | Registers the Attendance WhatsApp Flows with Meta via Graph API (created Jan 2026); --production flag |
| `register-coach-visit-request-template.js` | Registers coach_visit_request_v2 UTILITY template in en_US and ur from the shared template module (bd-v0toag.45) |
| `register-fa-video-template.js` | (unmapped) |
| `register-observe-report-template.js` | Registers the observation_report_sw UTILITY template used to reopen the 24h window for the teacher's report (FEAT-053) |
| `register-observe-visit-templates.js` | Registers the scheduled/rescheduled/cancelled teacher visit-notice UTILITY templates in en_US and ur (bd-xorfy) |
| `register-student-quiz-flow.js` | Registers the child's /quiz Flow from docs/flows/student-quiz-flow.json on one WABA and prints its id |
| `register-weekly-usage-templates.js` | Registers weekly_usage_v1 and weekly_usage_quiet_v1 UTILITY templates in en_US and ur; --status checks (bd-v0toag.32) |
| `requeue-lesson-plan.js` | Re-queues a pending lesson plan request to SQS by request id for the SQS worker |
| `revert-lp612-figure-notes.js` | Replays a backup to restore Grades 6-12 segment notes as before apply-lp612-figure-notes (bd-17mht) |
| `run_upload.sh` | Guarded one-command wrapper taking the rendered K-5 corpus to servable: dry run, r2-only, commit, verify-only |
| `sample-ping-dry-run.js` | Prints, as counts only, what the direct sample ping would do now via the ping service's dryRun |
| `seed-feat059-feat080-pakistan-lps.js` | Seeds pre_generated_lps pointers to the FEAT-059 and FEAT-080 Pakistan lesson PDFs already in R2 for PreGenLookupService |
| `seed-niete-leader-roles.js` | Seeds or migrates the ICT leader roles (Coach, Principal, AEO) so bulk-enrolled human_coach users pass /observe (FEAT-1… |
| `send-outage-broadcast.js` | One-off broadcast of an outage notice to users active on a given day in Dec 2025 |
| `set-conversational-components.js` | Publishes the conversational-components manifest (ice breakers, slash commands, welcome) to one number from bot config… |
| `setup-flow-encryption.js` | Generates an RSA-2048 key pair for Flow encryption, registers the public key with Meta, prints the private key for env |
| `simulate.js` | CLI simulator building WhatsApp webhook payloads from text input for local testing without WhatsApp |
| `upload-lp-v8-to-r2.js` | Compresses rendered v8 K-5 PDFs from the manifest, uploads to R2 by content hash and records niete_lp_assets; re-runnab… |
| `upload-lp612-figures.js` | Uploads only the figure crops a diagram plan references to the shared bucket under lp612/ (bd-17mht) |
| `upload-lp612-page-truth.js` | Uploads per-book _book.json, _toc.json and page JSONs so the Grades 6-12 runtime author can read printed-page text |
| `upload-reading-backgrounds.js` | Uploads generated reading-passage background images to R2 from the main bot directory |
| `upload-staging-video.js` | Uploads the registration video to the staging WABA and prints the media id for Railway staging env |
| `validate-env.js` | Presence-based env validator: confirms required vars set and lists optional features enabled; exit 1 if missing |
| `verify-lp-v8-r2.js` | Fetches an uploaded LP PDF through the same presigned path a teacher's phone uses and checks it against niete_lp_assets |

## Who reads this (all, generated)
- `build-lp-catalog.js` ← imported by `bot/scripts/lp-catalog-merge.js:42:c8e4b35f` · `bot/scripts/apply-lp-splits.js:14:4cb126a8`
- `lp-catalog-splits.js` ← imported by `bot/scripts/build-lp-catalog.js:32:60ad3b78` · `bot/scripts/apply-lp-splits.js:15:60ad3b78`
- column `niete_lp_assets.asset_kind` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:177:bcc39851` · `bot/shared/services/coaching/live-moves/card-store.js:49:6d6b56b2` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:47:2fff1c6b` · `bot/shared/services/lp-ab-ch310.service.js:81:99dc5e17` (+10: `python3 kg/kg.py who-reads niete_lp_assets.asset_kind`)
- column `niete_lp_assets.bytes` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/scripts/verify-lp-v8-r2.js:112:ed6ce269`
- column `niete_lp_assets.catalog_version` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/services/lp-v8-delivery.service.js:114:f7c96069` · `scripts/backfill-lp-fidelity-moves.js:39:1967989e`
- column `niete_lp_assets.content_hash` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:178:749a8246` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:53:b2096bb1` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:47:2fff1c6b` · `bot/shared/services/lp-ab-ch310.service.js:81:99dc5e17` (+8: `python3 kg/kg.py who-reads niete_lp_assets.content_hash`)
- column `niete_lp_assets.is_current` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/services/coaching/live-moves/card-store.js:50:ee732571` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:47:2fff1c6b` · `bot/shared/services/lp-ab-ch310.service.js:81:99dc5e17` · `bot/shared/services/lp-v10-card.service.js:28:2fff1c6b` (+4: `python3 kg/kg.py who-reads niete_lp_assets.is_current`)
- column `niete_lp_assets.lesson_id` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:176:9a814673` · `bot/shared/services/coaching/live-moves/card-store.js:47:c6a45353` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:53:b2096bb1` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:47:2fff1c6b` (+9: `python3 kg/kg.py who-reads niete_lp_assets.lesson_id`)
- column `niete_lp_assets.r2_key` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:175:e28a101f` · `bot/shared/services/coaching/live-moves/card-store.js:47:c6a45353` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:47:2fff1c6b` · `bot/shared/services/lp-ab-ch310.service.js:81:99dc5e17` (+4: `python3 kg/kg.py who-reads niete_lp_assets.r2_key`)
- column `niete_lp_assets.source_sha1` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/scripts/ingest-lp-v9-html.js:176:34db02f7`
- column `niete_lp_assets.version_stamp` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/services/coaching/live-moves/card-store.js:47:c6a45353` · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:53:b2096bb1` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:47:2fff1c6b` · `bot/shared/services/lp-ab-ch310.service.js:81:99dc5e17` (+7: `python3 kg/kg.py who-reads niete_lp_assets.version_stamp`)
- table `niete_lp_assets` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:174:c7464c20`? · `bot/shared/services/coaching/live-moves/card-store.js:46:c7464c20`? · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:52:c7464c20`? · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:46:c7464c20`? (+11: `python3 kg/kg.py who-reads niete_lp_assets`)
- table `pre_generated_lps` (written by `seed-feat059-feat080-pakistan-lps.js`) ← read by `bot/shared/routes/pakistan-lp-endpoint.js:95:a684f67f`? · `bot/shared/services/pregen-lookup.service.js:26:a684f67f`? · `bot/scripts/migration/survey-lp-inventory.js:59:a684f67f`?
- env `ALLOW_MISSING_CANVAS` read at `bot/scripts/assert-native-modules.js:18:533a7908`
- env `APP_URL` read at `bot/scripts/register-attendance-flows.js:39:4b8816ad`
- env `AWS_ACCESS_KEY_ID` read at `bot/scripts/requeue-lesson-plan.js:23:b1d05116`
- env `AWS_REGION` read at `bot/scripts/requeue-lesson-plan.js:22:2c79605f`
- env `AWS_SECRET_ACCESS_KEY` read at `bot/scripts/requeue-lesson-plan.js:24:2d6a8510`
- env `AXIOM_DATASET` read at `bot/scripts/quiz-funnel-watch.js:70:e919f174`
- env `AXIOM_TOKEN` read at `bot/scripts/check-balochi-history.js:11:67663e32` · `bot/scripts/debug-balochi.js:12:67663e32`
- env `ENV_FILE` read at `bot/scripts/run_upload.sh:63:4c591906`
- env `FLOW_ENDPOINT_BASE` read at `bot/scripts/register-student-quiz-flow.js:25:5b85a09e`
- env `GRAPH_API_VERSION` read at `bot/scripts/broadcast-fa-video.js:20:d04e05b0` · `bot/scripts/send-outage-broadcast.js:19:ddcada1f` · `bot/scripts/set-conversational-components.js:36:bbb8581f` · `bot/scripts/upload-staging-video.js:19:ddcada1f`
- env `LP_SEGMENTATION_DIR` read at `bot/scripts/build-lp-catalog.js:512:010859b5`
- env `LP_TOC_DIR` read at `bot/scripts/build-lp-catalog.js:513:bfd5f9f4`
- env `LP_V8_CORPUS` read at `bot/scripts/run_upload.sh:35:f093f4fa`
- env `LP_V8_LOG_DIR` read at `bot/scripts/run_upload.sh:155:be45d167` · `bot/scripts/upload-lp-v8-to-r2.js:791:ed3e9549`
- env `MISTRAL_API_KEY` read at `bot/scripts/exam-checker-dry-run.js:15:0dd6ee05`
- env `NIETE_ENV_FILE` read at `bot/scripts/run_upload.sh:36:8549e2c9`
- env `OPENAI_API_KEY` read at `bot/scripts/exam-checker-dry-run.js:18:d7d391c6`
- env `PHONE_NUMBER` read at `bot/scripts/simulate.js:38:ce60a1d4`
- env `PHONE_NUMBER_ID` read at `bot/scripts/broadcast-fa-video.js:69:6eac9260` · `bot/scripts/send-outage-broadcast.js:18:c79e4792` · `bot/scripts/set-conversational-components.js:45:89b78868` · `bot/scripts/setup-flow-encryption.js:30:c79e4792` · `bot/scripts/simulate.js:17:2c0e23ec` · `bot/scripts/upload-staging-video.js:17:2cab844a`
- env `PORT` read at `bot/scripts/simulate.js:127:5804ff21`
- env `R2_ACCESS_KEY_ID` read at `bot/scripts/upload-reading-backgrounds.js:15:d6f2a7a2`
- env `R2_BUCKET_NAME` read at `bot/scripts/upload-reading-backgrounds.js:20:90ddb4d1`
- env `R2_ENDPOINT` read at `bot/scripts/upload-reading-backgrounds.js:13:2684789e`
- env `R2_PUBLIC_URL` read at `bot/scripts/upload-reading-backgrounds.js:74:9762364c`
- env `R2_SECRET_ACCESS_KEY` read at `bot/scripts/upload-reading-backgrounds.js:16:5687c9ca`
- env `SQS_QUEUE_URL` read at `bot/scripts/requeue-lesson-plan.js:28:06371e86`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `bot/scripts/generate-coaching-excel.js:17:90118d4a` · `bot/scripts/requeue-lesson-plan.js:17:90118d4a` · `bot/scripts/seed-niete-leader-roles.js:22:a4b14f4f` · `bot/scripts/send-outage-broadcast.js:13:90118d4a`
- env `SUPABASE_URL` read at `bot/scripts/apply-lp612-figure-notes.js:61:c2c6132b` · `bot/scripts/apply-lp612-salutation-stamps.js:152:c2c6132b` · `bot/scripts/generate-coaching-excel.js:16:e84bc099` · `bot/scripts/ingest-lp-v9-html.js:157:8f304073` · `bot/scripts/requeue-lesson-plan.js:16:e84bc099` · `bot/scripts/revert-lp612-figure-notes.js:28:c2c6132b` · `bot/scripts/seed-niete-leader-roles.js:21:2a5ea60a` · `bot/scripts/send-outage-broadcast.js:12:e84bc099`
- env `WABA_ID` read at `bot/scripts/broadcast-fa-video.js:69:6eac9260` · `bot/scripts/register-attendance-flows.js:30:6007273c` · `bot/scripts/register-coach-visit-request-template.js:25:601afc5a` · `bot/scripts/register-observe-report-template.js:21:601afc5a` · `bot/scripts/register-observe-visit-templates.js:22:601afc5a` · `bot/scripts/register-student-quiz-flow.js:23:601afc5a` · `bot/scripts/register-weekly-usage-templates.js:19:601afc5a`
- env `WHATSAPP_API_VERSION` read at `bot/scripts/register-student-quiz-flow.js:21:14d03902`
- env `WHATSAPP_TOKEN` read at `bot/scripts/broadcast-fa-video.js:69:6eac9260` · `bot/scripts/register-attendance-flows.js:31:651a42a4` · `bot/scripts/register-coach-visit-request-template.js:26:99dd7162` · `bot/scripts/register-observe-report-template.js:22:99dd7162` · `bot/scripts/register-observe-visit-templates.js:23:99dd7162` · `bot/scripts/register-student-quiz-flow.js:24:99dd7162` · `bot/scripts/register-weekly-usage-templates.js:20:99dd7162` · `bot/scripts/send-outage-broadcast.js:17:60bafac2` · `bot/scripts/set-conversational-components.js:46:99dd7162` · `bot/scripts/setup-flow-encryption.js:31:babb0b93` · `bot/scripts/upload-staging-video.js:18:922e7ad9`

## Tests (all, generated)
- `apply-lp612-figure-notes.js` ← `tests/lp612/figure-notes-additive.test.js`
- `assert-native-modules.js` ← `tests/deploy/assert-native-modules.test.js`?
- `backfill-lp-asset-sources.js` ← `bot/tests/lp-v8/backfill-lp-asset-sources.test.js`
- `broadcast-fa-video.js` ← `bot/tests/fa-video/fa-video-broadcast-cli.test.js`
- `build-lp-catalog.js` ← `bot/tests/lp-v8/catalog-builder.test.js` · `bot/tests/lp-v8/elective-catalog-merge.test.js` · `bot/tests/lp-v8/elective-menu-names.test.js` · `tests/lp-v8/catalog-splits.test.js`
- `challenge-registry-seed.js` ← `bot/tests/quiz/web-quiz/challenge-bank-v4.test.js` · `bot/tests/quiz/web-quiz/challenge-grade1.test.js` · `bot/tests/quiz/web-quiz/challenge-passage-licence.test.js`
- `challenge-stock-seed.js` ← `bot/tests/quiz/web-quiz/challenge-stock-seed.test.js`
- `check-syntax.js` ← `bot/tests/unit/check-syntax.test.js`
- `export-lp612-segments.js` ← `tests/lp612/export-segments.test.js`
- `generate-observe-flow-json.js` ← `tests/coaching/bd-5n1a2-flow-generator-shape.test.js`
- `import-assessment-topics.js` ← `tests/assessment/topics/import-cli.test.js`
- `import-lp612-segments.js` ← `tests/lp612/export-segments.test.js` · `tests/lp612/import-salutation-carried.test.js` · `tests/lp612/import.test.js` · `tests/lp612/shared-grade-book.test.js` · `tests/lp612/video-withdrawal.test.js`
- `ingest-lp-v9-html.js` ← `bot/tests/lp-v8/ingest-lp-v9-html.test.js`
- `lp-catalog-merge.js` ← `bot/tests/lp-v8/elective-catalog-merge.test.js`
- `lp-catalog-splits.js` ← `tests/lp-v8/catalog-splits.test.js`
- `lp612-overlay-backfill.js` ← `tests/lp612/overlay-backfill-driver.test.js`
- `lp612-sidecar-audit.js` ← `tests/lp612/sidecar-audit.test.js`
- `quiz-funnel-watch.js` ← `tests/quiz/quiz-funnel-watch.test.js`
- `register-coach-visit-request-template.js` ← `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` · `tests/coaching/bd-v0toag.45-coach-visit-service.test.js`
- `register-fa-video-template.js` ← `bot/tests/fa-video/fa-video-template.test.js`
- `register-weekly-usage-templates.js` ← `bot/tests/coaching/weekly-report/register-script.test.js`
- `seed-feat059-feat080-pakistan-lps.js` ← `tests/pregen/feat-059-080-pakistan-lps.test.js`
- `simulate.js` ← `bot/scripts/e2e/child-test-sim/transports.js` · `bot/scripts/e2e/mock-graph-api.js` · `tests/e2e-mock/simulate-builders.test.js`
- `upload-lp-v8-to-r2.js` ← `bot/tests/lp-v8/upload-writes-slide-script.test.js` · `bot/tests/lp-v8/uploader-card-kind.test.js` · `bot/tests/lp-v8/uploader-r2-only.test.js` · `bot/tests/lp-v8/uploader-resumable.test.js` · `bot/tests/lp-v8/uploader.test.js`
- `upload-lp612-page-truth.js` ← `tests/lp612/page-truth-upload.test.js`
- `verify-lp-v8-r2.js` ← `bot/tests/lp-v8/uploader-r2-only.test.js`

## Related (all, generated)
- docs: `bot/CLAUDE.md`? · `docs/LP_PATHS.md`? · `docs/e2e-mock-lane.md`? · `docs/lp612/video-enhancement-test.md`?
