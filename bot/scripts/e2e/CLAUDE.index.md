# e2e — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/e2e -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `child-test-sim/` | Simulated coach visit against a fake, mock or sandbox bot for the child test → `child-test-sim/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `dns-pin.js` | node -r preload giving the mock lane a public-resolver DNS fallback when the machine's resolver fails |
| `flow-emulator.js` | Plays Meta's side of a WhatsApp Flow from stored FLOW_JSON, including endpoint encryption; not a rendering test |
| `flow-inventory.js` | Fetches each published Flow JSON by id, stores it as a fixture, records drift against repo copies and a component census |
| `hero-text.js` | Re-renders a coaching hero report's text from its session so a driver can read the FICO image; mock lane, refuses prod |
| `local-db-bootstrap.sql` | Provides Supabase roles, extensions schema and auth.uid/role/jwt on plain Postgres for local golden databases (bd-z3ze4) |
| `local-db-linux.test.sh` | Hermetic test of local-db install-tools and doctor on Linux with shimmed apt, sudo and curl (bd-z3ze4.8) |
| `local-db-proxy.js` | Tiny proxy mapping supabase-js /rest/v1 URLs to the local PostgREST root; other Supabase paths return 501 (bd-z3ze4) |
| `local-db.sh` | Manages the mock lane's per-run local Postgres+PostgREST database: up, down, baseline, seed-pull and seed-publish (bd-z… |
| `local-db.test.sh` | Hermetic test of local-db.sh: supabase-js access, clean per run, baseline refuses non-sandbox refs (bd-z3ze4) |
| `local-r2.js` | Local stand-in for Cloudflare R2: writes stay in the run folder, reads fall back read-only to a base snapshot (bd-z3ze4… |
| `local-r2.test.js` | Tests local-r2.js: writes never reach upstream and reads fall back to the read-only upstream bucket (bd-z3ze4.1) |
| `local-stack-env.test.sh` | Pins record-env.sh: real vendor keys once, all other settings from the lane, no prod settings leak (bd-hnhlgn.18) |
| `local-stack-keys.test.sh` | Regression: keys dir resolves to the level holding niete-local.env, not an empty shadow keys folder |
| `local-stack-ports.test.sh` | Pins that a second run on a taken slot refuses before touching anything and never kills the first run (bd-d2zge) |
| `local-stack-restart.test.sh` | Pins local-stack.sh restart working when the ports file lists five numbers, not four (bd-z3ze4.1) |
| `local-stack-retarget.test.sh` | Pins local-stack.sh retarget: new commit's worktree, env and stack.json updated, old procs stopped, unknown sha is a no… |
| `local-stack.sh` | Starts the bot from one pinned commit in a detached worktree behind the mock Graph API for the E2E mock lane; up/down/r… |
| `lp-feedback-e2e.js` | Local E2E smoke of the full LP feedback lifecycle against real NIETE Supabase with an in-memory Redis stub and stubbed… |
| `lp612-doc.js` | Puts or removes one Grades 6-12 lesson document in the lane's R2 bucket so backfilled deliveries have renders to point… |
| `mock-console.html` | Browser chat UI imitating WhatsApp that talks to the mock stack so a person can chat with the local bot |
| `mock-console.sh` | Brings up the mock stack and holds it open with the live mock-WhatsApp console URL until Ctrl+C |
| `mock-graph-api.js` | Local stand-in for Meta's WhatsApp Cloud API: serves /messages, keeps an ordered outbox, injects forged webhooks |
| `portable.sh` | Sourced helpers for macOS/Linux differences (port_listening etc.) used by local-db.sh, local-stack.sh, run-suite.sh (bd… |
| `portal-demo-seed.js` | Prints SQL for a made-up school network (schools, coach, teachers, classes, LPs, FICO) so the local portal has data |
| `portal-demo-seed.test.sh` | Tests local-db.sh demo-seed fills one run DB with schools, coach, principal, teachers and their activity (bd-hnhlgn) |
| `provision-local-keys.sh` | Builds the gitignored per-machine keys/niete-local.env the mock lane needs, automatically when missing |
| `provision-local-keys.test.sh` | Tests provision-local-keys.sh: sandbox DB lines only, placeholders for vendors, refuses non-sandbox ref and overwrite,… |
| `provision-local-modules.sh` | Gives the mock lane a node_modules tree built from one commit's lockfile without running npm in the shared clone (bd-va… |
| `provision-local-modules.test.sh` | Tests provision-local-modules.sh with an npm PATH shim so the lane never needs npm ci in the shared clone (bd-vaee9) |
| `quiz-job.js` | Enqueues one quiz job to the local stack's BullMQ worker or runs its handler directly |
| `record-env.sh` | Prints record-mode env layer: AI vendor keys once from the keys file, then lane settings with those keys removed (bd-hn… |
| `refresh-views.test.sh` | Tests local-db.sh refresh-views populates materialized views wherever Postgres lives; dev-portal uses it (bd-hnhlgn.3) |
| `sandbox-copy-finish.sql` | Post-load step for local-db sandbox-copy: advances sequences past copied ids, including text codes built from sequences… |
| `sandbox-copy.test.sh` | Tests local-db.sh sandbox-copy: refuses non-sandbox source, copies by column name, sequences advanced (bd-hnhlgn.2) |
| `seed-rows-used.js` | Finds which reference-table rows the tests actually read from queries.log, to size the minimal committed seed (bd-z3ze4… |
| `sweep.js` | Runs one worker periodic sweep (teacher-nudges, resume, stale, quiz-offer-prepare) now against the local stack |

## Who reads this (all, generated)
- table `lesson_plans` (written by `lp-feedback-e2e.js`) ← read by `bot/shared/database/bot-helpers.js:411:611f2601`? · `bot/shared/routes/quiz-flow-endpoint.js:158:611f2601`? · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:158:611f2601`? · `bot/shared/services/context.service.js:138:611f2601`? (+13: `python3 kg/kg.py who-reads lesson_plans`)
- table `lp_feedback` (written by `lp-feedback-e2e.js`) ← read by `bot/shared/services/lp-feedback.service.js:305:5cdfa157`? · `bot/scripts/migration/apply-017-lp-feedback.js:74:3f0e2a4e`?
- env `E2E_DNS_FALLBACK` read at `bot/scripts/e2e/dns-pin.js:14:bc98733d`
- env `E2E_SWEEP_NOW` read at `bot/scripts/e2e/sweep.js:30:4fe6fe8b`
- env `GRAPH_API_VERSION` read at `bot/scripts/e2e/flow-inventory.js:25:7eb5071a`
- env `LOCAL_DB_QUERY_LOG` read at `bot/scripts/e2e/local-db-proxy.js:23:118b736c`
- env `LOCAL_DB_REQUEST_LOG` read at `bot/scripts/e2e/local-db-proxy.js:20:e214357b`
- env `LOCAL_DB_TIMING_LOG` read at `bot/scripts/e2e/local-db-proxy.js:28:27e2db35`
- env `LOCAL_R2_BASE_DIR` read at `bot/scripts/e2e/local-r2.js:38:096d2c74`
- env `LOCAL_R2_READ_LOG` read at `bot/scripts/e2e/local-r2.js:30:bfc9c4b0`
- env `LOCAL_R2_UPSTREAM_BUCKET` read at `bot/scripts/e2e/local-r2.js:41:b4b2c5a6`
- env `LOCAL_R2_UPSTREAM_ENDPOINT` read at `bot/scripts/e2e/local-r2.js:40:fccfe2bc`
- env `LOCAL_R2_UPSTREAM_KEY_ID` read at `bot/scripts/e2e/local-r2.js:42:05565a03`
- env `LOCAL_R2_UPSTREAM_SECRET` read at `bot/scripts/e2e/local-r2.js:42:05565a03`
- env `MOCK_BOT_URL` read at `bot/scripts/e2e/mock-graph-api.js:162:8b4f6f59`
- env `MOCK_PORT` read at `bot/scripts/e2e/mock-graph-api.js:345:8244f87d`
- env `MOCK_TRANSCRIPT` read at `bot/scripts/e2e/mock-graph-api.js:178:e4107c22`
- env `NIETE_ENV_PATH` read at `bot/scripts/e2e/lp-feedback-e2e.js:40:a68be0aa`
- env `PHONE_NUMBER_ID` read at `bot/scripts/e2e/mock-graph-api.js:161:d4075fb7`
- env `R2_ACCESS_KEY_ID` read at `bot/scripts/e2e/lp612-doc.js:28:5b9d218a`
- env `R2_BUCKET_NAME` read at `bot/scripts/e2e/lp612-doc.js:32:1a32f3ec`
- env `R2_ENDPOINT` read at `bot/scripts/e2e/lp612-doc.js:28:5b9d218a`
- env `R2_SECRET_ACCESS_KEY` read at `bot/scripts/e2e/lp612-doc.js:28:5b9d218a`
- env `SUPABASE_URL` read at `bot/scripts/e2e/hero-text.js:17:cf88f718` · `bot/scripts/e2e/lp612-doc.js:20:879bfe5d` · `bot/scripts/e2e/quiz-job.js:26:a87c7f34` · `bot/scripts/e2e/sweep.js:23:a87c7f34`
- env `TEST_PHONE` read at `bot/scripts/e2e/lp-feedback-e2e.js:42:5acf4d7f`
- env `TEST_TOPIC` read at `bot/scripts/e2e/lp-feedback-e2e.js:43:c6fc4e30`
- env `WHATSAPP_TOKEN` read at `bot/scripts/e2e/flow-inventory.js:140:250e68a3`

## Tests (all, generated)
- (none)

## Related (all, generated)
- skills: `niete-mock-e2e`?
- docs: `.claude/skills/niete-mock-e2e/reference/exit-codes.md`? · `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/e2e/CLAUDE.index.md`? · `bot/scripts/e2e/CLAUDE.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/cache/CLAUDE.index.md`? · `bot/shared/services/cache/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.md`? · `docs/e2e-mock-lane.md`? · `docs/onboarding/local-portal.md`?
