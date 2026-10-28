# setup — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/setup -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `_audit-helpers/` | Static require-graph helper used by the orphan, cycle and unresolved-require audits → `_audit-helpers/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `added-lines-hygiene-lib.js` | Helper for the added-lines hygiene gate: patterns (built from parts) that find private tracker names in public code |
| `added-lines-hygiene.allowlist.json` | Shrink-only allowlist by file of existing lines holding private work-tracking names, tokens stored ROT13 |
| `added-lines-hygiene.test.js` | Gate: no private work-tracking names in added lines under bot, dashboard, scripts, tests, docs; legacy files allowlisted |
| `asset-references.test.js` | Guard that code path-joining into bot/marketing/<file> guards the read, since the repo ships no binary assets |
| `baseline-gate.test.js` | Tests tests/baseline-gate.js: catches a new failure hidden inside an already-red suite against baseline.snapshot.json |
| `bootstrap-db.test.js` | Tests infrastructure/scripts/bootstrap-db: applies schema, rls, seed SQL in order via injected executor; stops on error |
| `bot-migrations-lib.js` | Helper reading bot/database/migrations and the 00_complete-schema.sql mirror for the migration order and mirror gates |
| `bot-migrations-mirror.allowlist.json` | Shrink-only allowlist of legacy column drift between bot migrations and the schema mirror |
| `bot-migrations-mirror.test.js` | Gate: every table a bot migration creates has a matching CREATE TABLE and columns in the schema mirror |
| `bot-migrations-order.allowlist.json` | Shrink-only allowlist of migrations that use another's table without a -- requires: header |
| `bot-migrations-order.test.js` | Gate: -- requires: headers name real forward migrations, have no cycle, and cover tables a migration uses |
| `challenge-data-gates-lib.js` | Pure helpers for Challenge data gates: counted-reader detection, BEGIN/COMMIT in migrations, seed and passage titles |
| `ci-workflow-jobs-always-runnable.test.js` | Gate: no workflow has a single job gated by a job-level secrets.* if, which silently skips on template repos |
| `ci-workflow-no-silent-masks.test.js` | Gate: CI workflow steps must not end in || true, which silences failures, unless allowed |
| `circular-deps.allowlist.json` | Allowlist of known require cycles with a reason each, read by circular-deps.test.js |
| `circular-deps.test.js` | Audit: Tarjan SCC over the static require graph; any cycle must be allowlisted with a reason and still be live |
| `class-manager-flow-reserved-names-contract.test.js` | Guard: Class Manager Flow JSON names no field or payload key after a data_exchange envelope key |
| `column-completeness.test.js` | Guard: every column the bot code writes or reads exists in the schema, else allowlisted (Phase 5) |
| `config-overrides.test.js` | Tests env overrides of constants: NIETE logo key default (bd-2374), ElevenLabs voice IDs (bd-332), rate limit (bd-338) |
| `content-changes-trace.test.js` | Gate: an edited content file's changes trace is whole and its text_hash_before points at a text that is gone |
| `copy-deck-en-only.allowlist.json` | Allowlist of copy-deck keys allowed to exist in English only, read by copy-deck-lift.test.js |
| `copy-deck-lift.allowlist.json` | Allowlist of copy-deck lift drifts tolerated by copy-deck-lift.test.js |
| `copy-deck-lift.modules.json` | Map of surface modules whose strings must lift copy.v2.json keys, read by copy-deck-lift.test.js |
| `copy-deck-lift.test.js` | Gate: strings in code match bot/shared/config/copy.v2.json byte for byte; flags drift, missing and unclaimed keys |
| `copy-deck-quoted-labels.allowlist.json` | Allowlist of deck lines that quote a button label that no longer matches, read by the quoted-labels test |
| `copy-deck-quoted-labels.test.js` | Gate: a deck line quoting a button names it by that button's current label in Urdu and English |
| `copy-deck-readers.allowlist.json` | Allowlist of files that read copy.v2.json raw instead of through deckLine, read by copy-deck-readers.test.js |
| `copy-deck-readers.test.js` | Gate: code reads the copy deck through the one deckLine door so held and retired keys never show |
| `copy-deck-urdu-joiners.test.js` | Gate: deck Urdu joins final verbs and the words of the WhatsApp name with U+00A0; shrink-only allowlists |
| `copy-deck-urdu-orphans.allowlist.json` | Shrink-only allowlist of deck keys whose Urdu ends in an orphan verb after a plain space |
| `copy-deck-whatsapp-joiner.allowlist.json` | Shrink-only allowlist of deck strings with the WhatsApp name lacking a no-break joiner |
| `copy-whatsapp-joiner-files.allowlist.json` | Allowlist of code files exempt from the WhatsApp-name no-break joiner rule in the Urdu joiners test |
| `counted-readers.allowlist.json` | Allowlist of readers still keyed on the old meta.counted stamp, read by counted-readers.test.js |
| `counted-readers.test.js` | Gate: no reader keys on the old Challenge meta.counted stamp; rows are counted by mode='check' and record columns |
| `customization-doc-accuracy.test.js` | Guard: paths cited in docs/customization.md and docs/agent-customization.md resolve to real files |
| `dashboard-baseline-lib.js` | Helper reading dashboard-baseline.json so a full dashboard jest run's failures read as N new mechanically |
| `dashboard-baseline.json` | Known dashboard jest failures by suite and test name, with reasons, read by dashboard-baseline-lib |
| `dashboard-baseline.test.js` | Tests dashboard-baseline-lib newFailures on seeded jest --json results: baseline, new, whole-suite, fixed |
| `doctor-wording.test.js` | Guards npm run doctor wording: missing required vars say the bot refuses to start; dual-gate feature notes are shown |
| `doctor.test.js` | Tests bot/scripts/setup/doctor preflight: analyzeEnv, CHANGEME placeholders, injected probes never silently green |
| `edge-mounts.test.js` | Guard: dashboard edge-mounts and bot first-touch mounts lists are frozen, name-ordered, unique, own-path, mounted once |
| `entry-require-main-gates.test.js` | Guard: every entry point gates its top-level start behind require.main === module and exports the start function |
| `env-template-completeness.test.js` | Gate (bd-335): every process.env variable in bot/ code is documented in .env.template or allowed |
| `env-template-test-knobs.test.js` | Gate: no new Tests only record knob in .env.template; goldens record when their file is missing instead |
| `flow-client-error-logged.test.js` | Guard: the shared Flow decrypt path logs the client's error_message report, so render failures are visible |
| `flow-completion-contract.test.js` | Guard: Flow terminal screens declare extension_message_response params and endpoints return SUCCESS (bd-x7aprz.9) |
| `flow-config-conformance.test.js` | Guard: FLOW_CONFIGS, shipped Flow JSON, *_FLOW_ID env reads and mounted Flow endpoints all agree |
| `flow-configs-paths.test.js` | Guard: every Flow JSON in FLOW_CONFIGS exists on disk and parses; one set shared by registrar and validators |
| `flow-encryption-method-conformance.test.js` | Guard: flow routes only call FlowEncryptionService methods that exist (a missing one 500s Meta's health ping) |
| `flow-key-consistency.test.js` | Guard: setup-state validators require exactly the flows register-all-flows registers |
| `flow-screen-contract.test.js` | Guard: every screen a Flow endpoint returns is declared in its Flow JSON, one terminal screen, routable |
| `fresh-profile-pages.allowlist.json` | Allowlist of navigable pages exempt from the fresh-profile test rule, read by fresh-profile-pages.test.js |
| `fresh-profile-pages.test.js` | Gate: every web-quiz page template or render*Page has a fresh-profile test (no device id, cookie, cache) |
| `gen-log-raw-ids-allowlist.js` | CLI that regenerates or inspects log-raw-ids.allowlist.json: per-file counts of raw ids/phones on log lines |
| `gen-logger-allowlist.js` | CLI that regenerates or inspects the logger-level ratchet allowlist (formerly an untracked /tmp script) |
| `grade-form-one-home.allowlist.json` | Allowlist of files allowed to call formFor outside web-quiz-challenge, read by grade-form-one-home.test.js |
| `grade-form-one-home.test.js` | Gate: a child's challenge form is decided only in web-quiz-challenge formFor with the grade-1 switch |
| `language-single-source.test.js` | Conformance: one language-offer definition and one clamp implementation in bot/ (config/languages) |
| `leader-school-id.test.js` | Pins the additive migration giving leader_schools and two sibling tables a nullable school_id keyed to schools(id) |
| `link-integrity.test.js` | Guard: markdown links in CLAUDE.md routers and .claude skill docs resolve to real files and bot/ paths |
| `log-raw-ids-lib.js` | Pure scanner behind log-raw-ids: finds log properties carrying a raw person id or phone not keyed or masked |
| `log-raw-ids.allowlist.json` | Shrink-only per-file counts of log lines carrying raw ids or phones, generated by gen-log-raw-ids-allowlist |
| `log-raw-ids.test.js` | Gate: no new raw person id or phone on a log line, and no file above its allowlisted count |
| `logger-level-consistency.allowlist.json` | Grandfathered log-call callsites that print a failure marker without error level, read by the ratchet test |
| `logger-level-consistency.test.js` | Ratchet: new logToFile failure-marker calls must opt into error or warn level; backlog never grows |
| `logger-level-lib.js` | Shared scanner for the logger-level ratchet: parses logToFile calls and flags failures logged at info |
| `logger-level-lib.test.js` | Meta-tests for logger-level-lib scanViolations: multi-line calls, level argument parsing, stable keys |
| `lp-asset-sources-migration.test.js` | Pins migration V1.5.2 creating niete_lp_asset_sources (slide script of the served lesson version) with real DDL |
| `meta-api.test.js` | Tests bot/scripts/setup/meta-api MetaAPI wrapper for WhatsApp Business flow and template registration calls |
| `migrate.test.js` | Tests infrastructure/scripts/migrate MigrationRunner with a mocked supabase client: applied versions, ordering |
| `migration-check-lists.allowlist.json` | Allowlist of named CHECK lists remade by migrations that may narrow a later widening |
| `migration-check-lists.test.js` | Gate: a migration re-making a named CHECK IN list never narrows what a later migration widened it to |
| `migration-transaction-control.allowlist.json` | Allowlist of migrations carrying top-level BEGIN/COMMIT, read by migration-transaction-control.test.js |
| `migration-transaction-control.test.js` | Gate: new bot migrations carry no top-level BEGIN/COMMIT; listed legacy files may |
| `migrations-no-transaction-control.test.js` | Guard: migrations from V1.8.0 onward have no top-level transaction control, since exec_sql rejects it |
| `no-config-as-code-under-bot.test.js` | Guard: no bot/railway.json or railway.toml, since Railway services are configured in service settings |
| `no-eager-sdk-construction.test.js` | Guard: no SDK client is constructed at module load in bot/shared, bot/workers or dashboard |
| `no-hardcoded-bot-name.test.js` | Guard (bd-2365): teacher-facing text uses branding.botName from BOT_NAME, never a literal self-name |
| `no-hardcoded-brand-urls.test.js` | Guard: no upstream brand domains hardcoded in bot, dashboard, portal or scripts; one legal-mailbox exception |
| `no-hardcoded-coaching-strings.test.js` | Guard: coaching services route user-facing prose through getCoachingMessage; catalog covers all keys and languages |
| `no-legacy-coaching-monolith.test.js` | Ratchet (bd-1873): the legacy coaching.service monolith and its PG-queue worker stay deleted and unimported |
| `no-placeholder-fallback.test.js` | Guard: no placeholder domain used as a default for brand env vars; unset reads return null |
| `no-rumi-logo-bitmap.test.js` | Guard (bd-2368): no teacher-facing render references the Rumi brand bitmap; NIETE mark assets exist |
| `no-stranded-tests.test.js` | Guard (bd-1880): no *.test.js under a __tests__ directory in bot/ or dashboard/ that no runner collects |
| `no-undefined-flow-response-methods.test.js` | Guard (bd-2714): every FlowResponseHandler.<method>( call names a real export |
| `no-undefined-whatsapp-methods.test.js` | Guard: every WhatsAppService.<method>( call in bot source names a method the class defines |
| `npm-test-args.test.js` | Guard: nothing invokes npm test with arguments, because it is the whole-suite baseline gate |
| `orphan-modules.allowlist.json` | Allowlist of audited modules not reachable from any entry point, each with a reason |
| `orphan-modules.test.js` | Audit: every audited .js under services, handlers, storage, utils, config is reachable via require or allowlisted |
| `phone-shaped-fixtures-lib.js` | Scanner and shrink-only check for phone-shaped digit strings in test files of the public repo |
| `phone-shaped-fixtures.allowlist.json` | Shrink-only allowlist of test files still holding phone-shaped literals, read by the ratchet |
| `phone-shaped-fixtures.test.js` | Ratchet: no test file may carry +92 or 03-shaped digit strings; use the letters form fixtures |
| `procfile-targets-resolve.test.js` | Ratchet (bd-1874): every Procfile process command points at a file that exists |
| `ratchet-verdict-lib.js` | Shared verdict for shrink-only allowlist gates: fail above the list, warn below, returns failures and warnings |
| `raw-sql-schools-columns.test.js` | Guard: every column raw pool.query SQL reads from schools is declared in 00_complete-schema.sql |
| `register-all-flows.test.js` | Tests bot/scripts/setup/register-all-flows: all 24 FLOW_CONFIGS and their registration against a mocked MetaAPI |
| `register-all-templates.test.js` | Tests register-all-templates: TEMPLATE_CONFIGS, payload builders and registration against mocked MetaAPI and SetupState |
| `register-one-flow.test.js` | Tests register-one-flow: normalised flow-name matching and registering a single named flow on a non-empty WABA |
| `repo-mocks-partial.allowlist.json` | Allowlist of tests that fully mock a *.repo module without requireActual, read by repo-mocks-partial.test.js |
| `repo-mocks-partial.domock.allowlist.json` | Allowlist of jest.doMock of a repo without requireActual, read by repo-mocks-partial.test.js |
| `repo-mocks-partial.test.js` | Gate: a *.repo module may only be partially mocked in tests (jest.requireActual) so real return shapes run |
| `repo-seam-tests.allowlist.json` | Allowlist of module/repo seams that lack a seam test, read by repo-seam-tests.test.js |
| `repo-seam-tests.test.js` | Gate: every service requiring a *.repo has a <m>-seam.test.js under bot/tests that loads the real repo |
| `repo-spy-failure-only.allowlist.json` | Allowlist of tests spying on a repo outside a failure describe, read by repo-spy-failure-only.test.js |
| `repo-spy-failure-only.test.js` | Gate: jest.spyOn of a repo only inside a failure describe, never to hand the caller a made-up shape |
| `republish-flow-safety.test.js` | Guard: the republish-flow tool needs --yes to write to Meta and names the WABA it targets |
| `roster-apply-edits-contract.test.js` | Migration contract of roster_apply_edits: shared per-class advisory lock, run-id replay refusal, close not delete |
| `roster-audit-and-phone-migrations.test.js` | Pins V1.4.7 and V1.4.9 migrations present and agreeing with the reference schema (roster audit CHECK, phone width) |
| `roster-change-details-contract.test.js` | Migration contract of roster_change_class_details: nullable column, same lock, merge closes source with a reason |
| `roster-flow-reserved-names-contract.test.js` | Guard (bd-3e0v5): roster Flow JSON names no field or payload key after a data_exchange envelope key |
| `roster-flow-status-screens.test.js` | Contract for the roster Flow status, view and edit screens: routing edges, acyclic model, dropdown plus Continue |
| `roster-hand-over-contract.test.js` | Migration contract of roster_hand_over_class: per-class lock, actor stamped for the ledger, school-scoped, no deletes |
| `roster-import-fn-contract.test.js` | Migration contract of roster_import_students: one DB function, advisory lock per class, idempotent per run id |
| `run-js-args.test.js` | Tests tests/run.js: arguments pass to jest unchanged (spaces, quotes, pipes) and the Node flag is added to NODE_OPTIONS |
| `schema-completeness.test.js` | Guard: every table and RPC the bot code references has a CREATE TABLE or FUNCTION in the consolidated schema SQL |
| `schema-forward-references.test.js` | Guard: ADD COLUMN ... REFERENCES in 00_complete-schema.sql comes after the referenced CREATE TABLE |
| `schema-mirrors-migrations.test.js` | Guard: every table and column a migration creates is declared in 00_complete-schema.sql, which clones bootstrap from |
| `schema-production-parity.test.js` | Checks 00_complete-schema.sql matches the production table, function, trigger and index counts |
| `security.test.js` | Tests bd-331 no hardcoded INTERNAL_API_KEY default and bd-336 localhost MMS_SERVICE_URL warning in setup-validator |
| `select-columns-exist.allowlist.json` | Allowlist of quiz-service selects naming columns not in the schema, read by select-columns-exist.test.js |
| `select-columns-exist.test.js` | Gate: every .from().select() column in bot quiz services exists on its table in the schema (avoids 42703) |
| `setup-encryption.test.js` | Tests setupEncryption: RSA-2048 keypair generation, key file output and public-key registration with Meta |
| `setup-state.test.js` | Tests SetupState: .setup-state.json load/save of flow, template and encryption registration status |
| `setup-validator.test.js` | Tests bot setup-validator validateBootRequirements: boot-time env check returning ok, warnings, errors |
| `skill-md-video-claims.test.js` | Guard: setup SKILL.md names VIDEO_GENERATION_ENABLED, not R2_* keys, as the video feature requirement |
| `source-hygiene.test.js` | Guard for the public repo: no internal ticket refs in shipped source or docs/flows JSON authoring metadata |
| `spoken-replies-availability.test.js` | Tests feature-availability: spoken replies are available with any voice provider, not one vendor's key |
| `stock-seed-titles.test.js` | Gate: Challenge stock seed SQL titles equal the passage files' titles in bot/shared/data/child-test/passages |
| `student-identity-migration-contract.test.js` | Migration contract: students get an internal id, school anchor, admission-number recognition data and a human handle |
| `table-double-rows-reads.allowlist.json` | Allowlist of tests reading .rows.<field> on the table double write, read by table-double-rows-reads.test.js |
| `table-double-rows-reads.test.js` | Gate: tests using the shared table double read .raw or .rows[0], never .rows.<field> on a write |
| `table-usage-conformance.test.js` | Guard: every CREATE TABLE in the schema is referenced in bot, dashboard or infrastructure code, or allowlisted |
| `teacher-nudges-migration.test.js` | Pins V1.5.3 teacher_nudges migration text: idempotent create, kind and status CHECK lists, unique per day |
| `teacher-reference-copies.allowlist.json` | Allowlist of copies of the teacher keyed-reference HMAC, read by teacher-reference-copies.test.js |
| `teacher-reference-copies.test.js` | Gate: the teacher keyed reference is computed only by tk() in web-quiz-kid, no new local copies |
| `test-connections-output.test.js` | Guard: validate:connections never prints All connections successful when every check was skipped |
| `test-seam-gates-lib.js` | Large shared library of pure readers behind the test-seam gates (repo mocks, copy deck, select columns, fresh-profile) |
| `tracked-files-pii-lib.js` | Scanner for phone numbers and machine paths in every tracked file of the public repo (bd-5gyspy.3) |
| `tracked-files-pii.allowlist.json` | Shrink-only allowlist of tracked files with phone or machine-path hits; the QA ledger can never be listed |
| `tracked-files-pii.test.js` | Gate (bd-5gyspy.3): tracked files carry no phone number or home-directory path, via tracked-files-pii-lib |
| `tts-single-seam.test.js` | Guard: no bot code outside the voice gateway calls a speech vendor directly |
| `unresolved-requires.allowlist.json` | Allowlist of try/catch-wrapped require() calls that intentionally point at missing files, each with a reason |
| `unresolved-requires.test.js` | Audit: every literal require in reachable code resolves, or is try/catch-wrapped and allowlisted with a reason |
| `unused-deps.test.js` | Guard: every bot/package.json dependency is require()d somewhere in shipped code |
| `users-soft-delete-schema.test.js` | Pins V1.4.6 soft-delete migration: add_soft_delete helper and users.deleted_at/reason/by columns present |
| `validate-flows.test.js` | Tests validate-flows preflight: flows and templates exist and are PUBLISHED, encryption configured; returns valid/issues |
| `version-check.test.js` | Tests bot version-check checkForUpdates: up-to-date vs newer release, fails silently on network or JSON errors |
| `virtual-mock-of-existing-module.allowlist.json` | Shrink-only allowlist of virtual: true mocks of modules that exist in the tree |
| `virtual-mock-of-existing-module.test.js` | Gate: no jest.mock virtual:true of a module that exists, which resolves by worker file order |
| `watch-root-one-reader.test.js` | Guard: the watch root VALUE key is spelled only in watch-root.js so every reader shares one parser |
| `web-quiz-owned-paths.js` | Helper listing the web quiz's own path prefixes so module lists beside query goldens compare only inside them |
| `web-quiz-owned-paths.test.js` | Tests the owned-paths filter: foreign modules ignored, own new or removed modules change the list |
| `web-quiz-v2-identity-migration.test.js` | Pins the web_quiz_v2_identity migration: one nullable class column on quiz_share_codes, idempotent, partial index |
| `worker-boot.test.js` | Audit: forks every web and worker entry point with a minimal env to assert the require chain loads, reaps children |

## Who reads this (all, generated)
- table `students` whole row (`*`) (written by `select-columns-exist.test.js`) ← read by `bot/shared/services/student-list.service.js:362:d2b02c3e`?
- table `niete_lp612_renders` (written by `schema-completeness.test.js`) ← read by `bot/shared/services/coaching/portal-lesson-plan-library.service.js:117:3534712c`?
- table `students` (written by `select-columns-exist.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? · `bot/shared/routes/roster-flow-endpoint.js:775:3776d591`? · `bot/shared/routes/student-videos-endpoint.js:266:d71c8cd6`? (+42: `python3 kg/kg.py who-reads students`)
- env `ASSET_BASE_URL` read at `tests/setup/register-all-templates.test.js:431:9abcc777`
- env `BOT_NAME` read at `tests/setup/no-hardcoded-bot-name.test.js:126:ab910b3a`
- env `FAKE_JEST_EXIT` read at `tests/setup/run-js-args.test.js:22:9f236ac2`
- env `INTERNAL_API_KEY` read at `tests/setup/security.test.js:44:d48c04b8`
- env `MMS_SERVICE_URL` read at `tests/setup/security.test.js:93:fdb6b684`
- env `NODE_ENV` read at `tests/setup/security.test.js:45:0d319ea4`
- env `NODE_OPTIONS` read at `tests/setup/run-js-args.test.js:21:6cb25430`
- env `RUMI_LOGO_R2_KEY` read at `tests/setup/config-overrides.test.js:44:e2f20f39`

## Tests (all, generated)
- (none)

## Related (all, generated)
- skills: `qa-testing`? · `whatsapp-flows`?
- docs: `.claude/CLAUDE.md`? · `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `CLAUDE.md`? · `bot/marketing/README.md`? · `bot/scripts/setup/CLAUDE.index.md`? · `bot/scripts/setup/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/vendor/lp-v9/lib/CLAUDE.index.md`? · `docs/CLAUDE.index.md`? · `docs/customization.md`? · `docs/data-standards.md`? · `docs/migration/06-from-main-rumi-bot.md`? · `docs/migration/CLAUDE.index.md`? · `docs/migration/DEPLOYMENT.md`? · `docs/templates/roster-change-notification.md`? · `infrastructure/scripts/CLAUDE.md`? · `tests/BASELINE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/setup/CLAUDE.index.md`? · `tests/setup/CLAUDE.md`? · `tests/setup/_audit-helpers/CLAUDE.md`?
