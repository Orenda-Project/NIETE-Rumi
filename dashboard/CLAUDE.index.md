# dashboard — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `config/` | → (no door; 2 files) |
| `data/` | Frozen data files read by COACHIP services → `data/CLAUDE.md` |
| `database/` | DB layer: analytics queries and ad-hoc SQL migration runner → `database/CLAUDE.md` |
| `docs/` | Operator notes for the dashboard: DNS runbook, partner RBAC, API health, media → `docs/CLAUDE.md` |
| `jobs/` | → (no door; 1 files) |
| `lib/` | Small shared helpers: feature flags, edge switches, date rules, COACHIP insights job → `lib/CLAUDE.md` |
| `middleware/` | Express middleware: session auth, request timeout, latency logging, RBAC → `middleware/CLAUDE.md` |
| `portal-frontend/` | → (no door; 1 files) |
| `public/` | Static files the dashboard Express app serves: built CSS, logo, the child web-quiz assets → `public/CLAUDE.md` |
| `routes/` | Express routers: portal API, coach/teacher app APIs, child-quiz edge pages, admin routes → `routes/CLAUDE.md` |
| `sa-game/` | → (no door; 2 files) |
| `sa/` | Self-administered reading/maths battery engine served at /sa/*, offline-first → `sa/CLAUDE.md` |
| `scripts/` | One-off ops scripts: transcript backfill, SQS setup, font builds, Urdu fit walk → `scripts/CLAUDE.md` |
| `services/` | Business logic: analytics, coach/teacher app reads, COACHIP, bot HTTP clients, email → `services/CLAUDE.md` |
| `supabase/` | Local Supabase CLI config for the dashboard database → `supabase/CLAUDE.md` |
| `tests/` | Jest suite for the dashboard server: web-quiz edge, SA runner, leader services → `tests/CLAUDE.md` |
| `views/` | EJS pages for the observability admin portal plus one static demo HTML → `views/CLAUDE.md` |
| `workers/` | → (no door; 1 files) |
| `.gitignore` | (unmapped) |
| `README.md` | Phase-2 overview of the observability dashboard: features, prerequisites (bot deployed, same Supabase DB), setup. |
| `cluster.js` | Cluster wrapper that forks up to 4 workers running index.js so slow GPT requests cannot block portal static serving. |
| `entrypoint.js` | Railway entrypoint: runs the portal server or the SQS worker depending on the WORKER_MODE env var. |
| `index.js` | Main Express app: sessions, CORS, limits, mounts every router and admin page, serves the portal build; 3.8k lines. |
| `jest.config.js` | Default dashboard jest config: node env, testRegex for service/middleware/rls/e2e tests, 30s timeout, tests/setup.js. |
| `jest.rbac.config.js` | Jest config that runs only rls-policies.test.js with a 60s timeout for DB-backed RLS checks. |
| `jest.service.config.js` | Jest config for service tests without tests/setup.js (its localStorage setup breaks on Node 25+). |
| `package.json` | rumi-dashboard npm manifest: cluster start script, tailwind CSS build, jest test runner and server dependencies. |
| `railway.toml` | Railway deploy config: nixpacks build, node entrypoint.js start, /health check, restart ALWAYS (max 5). |
| `run-phase6-tests.sh` | Runs the GitHub API and Redis cache jest tests sequentially to avoid Node v25 problems. |
| `run-tests.sh` | Dashboard jest wrapper (unsets ELECTRON_RUN_AS_NODE, runs npx jest --verbose with passed args); npm test calls it. |
| `tailwind.config.js` | Tailwind config scanning views/*.ejs and public js with shadcn-style CSS-variable colors for the admin pages. |
| `test-login.js` | Manual script verifying a password against the ADMIN_PASSWORD_HASH env bcrypt hash; not a jest test. |
| `test-portal-api.sh` | Curl-based smoke script exercising the 12 teacher-portal API endpoints against a base URL. |
| `test-rls-with-supabase-client.js` | Manual script testing RLS behaviour through the Supabase JS client the Express app uses; not run by jest. |

## Who reads this (all, generated)
- `index.js` ← imported by `dashboard/cluster.js:79:6e322920`
- column `access_scopes.dashboard_user_id` (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/services/auth.service.js:45:ab5cd5e1`
- column `coaching_sessions.analysis_data` (written by `index.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` · `bot/shared/routes/observe2-check-endpoint.js:297:ed6f6cd9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+32: `python3 kg/kg.py who-reads coaching_sessions.analysis_data`)
- column `dashboard_users.email` (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/index.js:560:f2112f9b` · `dashboard/services/auth.service.js:231:19a724f0` · `dashboard/services/byof.service.js:359:3df8e978`
- column `dashboard_users.is_active` (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/services/auth.service.js:21:f8c426e2` · `dashboard/services/byof.service.js:359:3df8e978`
- column `dashboard_users.password_hash` (written by `index.js`, `test-rls-with-supabase-client.js`) ← read by `dashboard/services/auth.service.js:190:7a1021df`
- column `dashboard_users.role` (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/services/auth.service.js:231:19a724f0` · `dashboard/services/byof.service.js:359:3df8e978`
- column `dashboard_users.username` (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/index.js:560:f2112f9b` · `dashboard/services/auth.service.js:20:824c5b0f` · `dashboard/services/byof.service.js:359:3df8e978`
- table `access_scopes` whole row (`*`) (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/services/auth.service.js:44:d2b02c3e`?
- table `coaching_sessions` whole row (`*`) (written by `index.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+5: `python3 kg/kg.py who-reads coaching_sessions`)
- table `dashboard_users` whole row (`*`) (written by `index.js`) ← read by `dashboard/services/auth.service.js:19:d2b02c3e`?
- table `access_scopes` (written by `test-rls-with-supabase-client.js`) ← read by `dashboard/services/access-scope.service.js:49:4c770aa9`? · `dashboard/services/auth.service.js:43:2be8f4d7`?
- table `coaching_sessions` (written by `index.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)
- table `dashboard_users` (written by `index.js`, `test-rls-with-supabase-client.js`) ← read by `dashboard/index.js:559:36baffc0`? · `dashboard/middleware/auth.js:76:9a69d293`? · `dashboard/middleware/rbac/feature-access.js:53:9a69d293`? · `dashboard/middleware/rbac/rbac.js:49:9a69d293`? (+5: `python3 kg/kg.py who-reads dashboard_users`)
- table `invitations` (written by `index.js`) ← read by `dashboard/services/invitation.service.js:60:dbabc154`?
- env `ADMIN_PASSWORD` read at `dashboard/test-login.js:9:68b2e053`
- env `ADMIN_PASSWORD_HASH` read at `dashboard/index.js:157:4a55f6fa` · `dashboard/test-login.js:12:fade072a`
- env `ADMIN_USERNAME` read at `dashboard/index.js:156:f83ca370`
- env `BROADCAST_PASSWORD` read at `dashboard/index.js:3142:3668487d`
- env `CLUSTER_ENABLED` read at `dashboard/cluster.js:17:06847e1e`
- env `CLUSTER_WORKERS` read at `dashboard/cluster.js:16:aa843f44`
- env `DASHBOARD_PORT` read at `dashboard/index.js:147:8d77e70c`
- env `DATABASE_URL` read at `dashboard/index.js:3866:f91d5302`
- env `PORT` read at `dashboard/index.js:147:8d77e70c`
- env `PORTAL_URL` read at `dashboard/index.js:372:f16b34e0`
- env `REDIS_URL` read at `dashboard/index.js:221:6f542357`
- env `SESSION_COOKIE_NAME` read at `dashboard/index.js:306:79b1f2a1`
- env `SESSION_SECRET` read at `dashboard/index.js:305:982a5641`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `dashboard/test-rls-with-supabase-client.js:10:8817679a`
- env `SUPABASE_URL` read at `dashboard/test-rls-with-supabase-client.js:9:58448145`
- env `WEBSITE_URL` read at `dashboard/index.js:371:2dd1e187`
- env `WORKER_MODE` read at `dashboard/entrypoint.js:16:7b8b694c`

## Tests (all, generated)
- `jest.config.js` ← `tests/jest.config.js`?

## Related (all, generated)
- docs: `CLAUDE.md`? · `docs/app-funnel-telemetry.md`? · `docs/architecture.md`? · `docs/migration/09a-capacitor-wrapping.md`? · `docs/migration/DEPLOYMENT.md`? · `docs/monitoring.md`? · `docs/onboarding/local-portal.md`? · `portal/ANDROID.md`?
- service: `railpack.portal.json` · `railway.toml`
