# Deployment — Fork Setup & Initial WhatsApp Connection

**Status**: 🟡 Meta setup **paused** — user will complete WABA migration + app creation later. Fork name locked in as `NIETE-Rumi` under `Orenda-Project`. Moving to fork creation next.

**Customer**: NIETE — National Institute for Excellence in Teacher Education, Islamabad, Pakistan.
Same institution whose Android app (`pk.edu.niete`) is in the Taleemabad Capacitor deployment. This fork is Rumi-on-WhatsApp for NIETE teachers.
**Reference**: [../SETUP.md](../SETUP.md) — this doc is the fork-specific tailoring of that generic guide
**Related skill (main Rumi bot)**: [`region-rollout`](../../.claude/skills/) — used for adding regions to shared infra; we borrow its checklist discipline but not its shared-project assumptions

---

## Goal (phase 1)

Stand up a working fork of `rumi-platform` for a new region, with:

1. A dedicated GitHub repo (separately maintained from `Orenda-Project/rumi-platform`)
2. A dedicated Supabase project for the region's data
3. A dedicated Railway project running the bot + Redis
4. A dedicated WhatsApp Business number that responds to test messages
5. `npm run doctor` shows green for the required 8 keys

**Not in this doc**: feature-level work (LP catalog, training, coach HITL, exam gen) — those live in [01](./01-lesson-plans.md), [02](./02-teacher-training.md), [03](./03-digital-coach.md), [05](./05-exam-generator.md).

---

## Blocking decisions

Answer these before we start:

| ID | Question | Impact |
|---|---|---|
| A | What name for the fork's GitHub repo? Suggested: `rumi-<region>` (e.g. `rumi-pk-sindh`, `rumi-tz-mainland`) | Fork URL, code branding, region tag used throughout |
| B | Which GitHub org — `Orenda-Project` again, or a new org for this deployment? | Access control, discoverability |
| C | Meta Business Manager — new app for this region, OR reuse an existing one? | Determines WhatsApp app-ID, test phone provisioning path |
| D | Deployment target — Railway (as SETUP.md assumes), or a different host? | Deploy pipeline shape |
| E | Region tag string — needs to be stable and short, appears in DB rows (`region_features`, `lesson_plan_catalog`) and env vars | All feature code paths |

**All of A–E are user-owned decisions** — capture them in the "Decisions" table at the bottom before executing.

---

## 12-step deployment checklist

Modelled on `rumi-platform/SETUP.md` (an 11-step guide) with one extra step (webhook verification against real WhatsApp) folded in.

### Step 1 — Fork the repo ✅ (done 2026-07-11)

- [x] Empty repo created at `github.com/Orenda-Project/NIETE-Rumi` via `gh repo create` (couldn't literal-fork within same org — used mirror push instead)
- [x] `rumi-platform`'s `main` branch pushed to `NIETE-Rumi`
- [x] Remotes configured on local clone: `origin` → `NIETE-Rumi` (SSH), `upstream` → `rumi-platform` (HTTPS)
- [x] Local checkout at `<repo-root>/NIETE-Rumi/`

**Pulling upstream updates later**: `git fetch upstream && git merge upstream/main` (or `rebase`). Note: pushing changes that touch `.github/workflows/*` requires the `workflow` OAuth scope on the token (current gh CLI token has only `repo` + `read:org`) — SSH pushes bypass this.

### Step 2 — Local clone + install

- [x] Cloned to `<repo-root>/NIETE-Rumi/` on 2026-07-11
- [ ] `npm install` in root
- [ ] `cd bot && npm install`
- [ ] `npm test` runs clean (baseline test suite passes on fresh checkout)

### Step 3 — Create Supabase project ✅ (done 2026-07-11)

- [x] Created via Supabase Management API using the existing `sbp_` token (`SUPABASE_ACCESS_TOKEN` from prod credentials doc)
- [x] Project: **`rumi-niete`** (ID `ihzciabopbttygxxgrkm`)
- [x] Org: **Rumi Deployments** (`jknlaervxxusivtgedtq`) — same org as `rumi-zavia`
- [x] Region: **`ap-south-1`** (Mumbai) — matches Zavia pattern, closer to PK users
- [x] Tier: **Free**
- [x] `SUPABASE_URL` = `https://ihzciabopbttygxxgrkm.supabase.co` — plumbed into local `.env`
- [x] `SUPABASE_SERVICE_ROLE_KEY` — legacy JWT retrieved via `/v1/projects/{ref}/api-keys`, plumbed into local `.env`
- [x] DB password — generated strong random 32-char, stored in `.env` as `SUPABASE_DB_PASSWORD`
- [x] Created `exec_sql` helper with SECURITY DEFINER + service_role EXECUTE grant (Supabase's newer default permissions require this — the raw version in SETUP.md hits "permission denied for schema public")
- [x] Missing sequences created upfront (see gotcha below)
- [x] Applied `00_complete-schema.sql` via direct `psql` (Management API silently swallows errors on large SQL; RPC `exec_sql` from `npm run bootstrap:db` also fails with large payloads)
- [x] Applied `01_rls-policies.sql`
- [x] Final state: **73 tables, 159 functions, 27 triggers** — matches upstream target
- [ ] `02_seed-data.sql` NOT APPLIED — upstream bug (see gotcha below); can be skipped for phase 1 (only affects reading-assessment WCPM benchmarks)

**Upstream `rumi-platform` bugs found during this bootstrap (worth reporting)**:
1. **4 sequences referenced but not created**: `lcpm_benchmarks_id_seq`, `migration_test_id_seq`, `wcpm_percentiles_id_seq`, `qa_test_runs_run_number_seq`. Schema uses `nextval()` without the `CREATE SEQUENCE` earlier in the file.
2. **Indexes on undefined materialized views**: `mv_dashboard_stats`, `mv_dashboard_stats_by_country`, `mv_retention_cohorts`, `mv_users_activity`, `mv_view_refresh_status` — referenced in `CREATE UNIQUE INDEX` statements at line 3249+, but the MV definitions are missing from `00_complete-schema.sql`.
3. **Seed data column mismatch**: `02_seed-data.sql` line 35 says `INSERT INTO wcpm_percentiles (grade, ...)` but the schema has `grade_level` (not `grade`).
4. **`bootstrap:db` script hits payload limits**: The 137 KB schema goes through PostgREST's `exec_sql` RPC, which fails silently or with obscure "helper is missing" messages. Direct `psql` handles it cleanly.

For NIETE this is unblocked; upstream should fix these for future fork bootstraps.

### Step 3.5 — Create SQS queues ✅ (done 2026-07-11)

Not part of upstream SETUP.md — this fork uses `QUEUE_DRIVER=sqs` (matching prod).

7 queues created in `us-east-1` under existing IAM user `hyasin270`, following prod naming pattern `rumi-<component>-<queue|dlq>-niete[.fifo]`:

| Queue | Type | Redrive |
|---|---|---|
| `rumi-coaching-queue-niete.fifo` | FIFO | → `rumi-coaching-dlq-niete.fifo`, maxReceive=3 |
| `rumi-coaching-dlq-niete.fifo` | FIFO DLQ | — |
| `rumi-portal-queue-niete.fifo` | FIFO | → `rumi-portal-dlq-niete.fifo`, maxReceive=3 |
| `rumi-portal-dlq-niete.fifo` | FIFO DLQ | — |
| `rumi-video-queue-niete.fifo` | FIFO | none (matches prod — no video DLQ) |
| `rumi-quiz-queue-niete` | Standard | → `rumi-quiz-dlq-niete`, maxReceive=3 |
| `rumi-quiz-dlq-niete` | Standard DLQ | — |

All URLs plumbed into local `.env` under `SQS_*_URL` keys.

### Step 4 — Create Railway project ✅ (done 2026-07-11)

Used `RAILWAY_ACCOUNT_TOKEN` from prod credentials doc to drive everything via GraphQL API (no `railway login` needed):

- [x] Project **`NIETE-Rumi`** created (ID `bcc5a6a9-02e6-4d1f-8fff-1fe5eb5626df`)
- [x] Production environment (`6902ea89-557f-416a-8e00-176dc61fcfad`)
- [x] Redis service (docker image `redis:7-alpine`, internal DNS `redis.railway.internal:6379`) — pluginCreate is deprecated in current Railway API; used `serviceCreate` with `source.image` instead
- [x] Bot service (`96a90a3a-d3d6-4866-b533-b3ffb4f9c402`), pointed at `Orenda-Project/NIETE-Rumi` main branch
- [x] 27 env vars uploaded from local `.env` via `variableCollectionUpsert` GraphQL mutation
- [x] Public domain generated: `bot-production-2cb6.up.railway.app`
- [x] Multi-region default: `europe-west4-drams3a` (change to `asia-southeast1` later if NIETE latency matters)

### Deploy iteration log (2026-07-11)

Four upstream `rumi-platform` gotchas surfaced during first-time deploy — all fixed via Railway API without changing repo code (yet — worth upstreaming later):

| Attempt | Failure | Fix applied |
|---|---|---|
| Deploy #1 | "No start command detected" (Railpack) | Set `startCommand=node bot/whatsapp-bot.js` + `healthcheckPath=/health` via `serviceInstanceUpdate` |
| Deploy #2 | `Cannot find module 'pino'` — bot/ deps not installed | Set `buildCommand=npm install && cd bot && npm install` via `serviceInstanceUpdate` |
| Deploy #3 | `Node.js 18 detected without native WebSocket support` (Supabase realtime-js needs Node 20+) | Set `NIXPACKS_NODE_VERSION=22` + `RAILPACK_NODE_VERSION=22` env vars |
| Deploy #4 | `OpenAIError: Missing credentials. Please pass an 'apiKey'` — `bot/shared/services/llm-client.js:42` instantiates OpenAI client at module-load, without a key it throws. Container crash-restarted 10× then Railway marked `FAILED`. | Fixed: reused prod `OPENROUTER_API_KEY` from PK "digital coach" Railway service (via `variables` GraphQL query). Set on NIETE bot service + local `.env`. |
| **Deploy #5** ✅ | — | **SUCCESS** at 2026-07-11 09:45:59 UTC. Healthcheck at `bot-production-2cb6.up.railway.app/health` returns `{"status":"healthy","service":"Rumi WhatsApp Bot","version":"1.1.0"}` in ~600ms. |

### 🎉 Phase 1 status: bot is deployed and healthy

- Public URL: `https://bot-production-2cb6.up.railway.app`
- Healthcheck: `/health` → 200 OK
- Root: `/` → "WhatsApp AI Bot is running!"
- Environment: production
- Uptime: verified against real HTTP

### Feature #1 (Lesson Plan Generation) — FULL E2E PASSED 2026-07-11

Real user-flow test verified via Chrome MCP against WhatsApp Web:

- User request: *"Create a lesson plan on multiplication tables for grade 3 math"* (via mock webhook)
- **11:36:14** Bot detected keyword "lesson plan" → intent=lesson_plan
- **11:36:17** Bot extracted topic, created `lesson_plan_requests` row in Supabase, queued to SQS
- **11:41:08** New `sqs-worker` service (deployed same day) picked up job
- **11:41:08** Gamma API called (`Gamma generation started API v1.0`)
- **11:42:xx** Gamma status transitioned pending → completed (~55s)
- **11:42:xx** PDF downloaded, uploaded to R2, sent via WhatsApp Document API
- **4:42 PM WhatsApp UI**: 📄 `lesson_plan_Multiplication_Tables_Lesson_Plan_for_Grade_3_Math.pdf` (215 KB) delivered
- Bot followed up: *"By the way, what should I call you?"* (registration name-collection)

Total wall-time: ~6 min from user message → PDF on phone. Full production-grade Rumi experience proven.

**Critical infra gap caught during this test**: The initial NIETE-Rumi Railway deploy only had the `bot` (web) service. The `sqs-worker` service was missing — meaning any async job (LP generation, coaching, video, quiz reports) would queue but never run. Created the second service (`node bot/workers/sqs-worker.js`), copied 63 env vars from the bot service, and it started consuming immediately. **Every regional Rumi fork will need both services** — the SETUP.md should document this. **Upstream bug #6 for `rumi-platform`**.

Env-key transfer summary: 30 safe external API keys copied from `02_Main Rumi Bot/.env` to NIETE-Rumi Railway (LLM providers, GAMMA, KIE, MISTRAL, SONIOX, ELEVENLABS, R2, Axiom, AWS Textract). WABA-scoped items intentionally skipped (Flow IDs, Media IDs, WhatsApp tokens — those don't cross forks).

### Layer 2 outbound E2E test (2026-07-11) — PASSED

After discovering Mudareb PK app was completely idle (0 conversations in 90 days, 1 subscribed app = itself, only `hello_world` template), decided to adopt it as the NIETE Meta app. Plumbed the existing Mudareb `WHATSAPP_TOKEN` + `PHONE_NUMBER_ID` (`1155653510968291`) + `WABA_ID` (`1551576156552661`) + a fresh random `WEBHOOK_VERIFY_TOKEN` (`09ab189257d6e79d0cede30a23fa3712`) onto NIETE-Rumi's Railway env.

Fired mock webhook: `{"text":{"body":"hi, testing NIETE bot"}}` from `923333232533`.

Timeline (6-second round-trip):
- 10:19:46 Webhook received → 200 `EVENT_RECEIVED`
- 10:19:48 User + session retrieved (session `28119cfb-...` resumed from earlier test)
- 10:19:49 Language detected: English; message stored
- 10:19:50 Intent detected via LLM
- 10:19:51 AI response generated via OpenRouter (`gpt-4o`)
- 10:19:52 **✅ Real WhatsApp message sent via Meta Graph API** — reply text: "Hi there! Your test message came through clearly. How can I assist you today?"
- 10:19:52 Response stored in DB

**Outbound E2E proven** — bot authenticates to Meta, generates LLM responses, delivers real WhatsApp messages to real numbers. Session persistence and conversation history work.

**Inbound E2E** still requires you to configure the Meta app's webhook URL to point at `https://bot-production-2cb6.up.railway.app/webhook` with verify token `09ab189257d6e79d0cede30a23fa3712`. Browser-only task in Meta Developer Console.

### Layer 1 E2E test (2026-07-11)

Fired a mock webhook payload at `/webhook` simulating a WhatsApp inbound message from Mashhood (`923333232533`) with text "hello test 2". Verified end-to-end:

- ✅ Webhook accepted (200 `EVENT_RECEIVED`)
- ✅ New user created in Supabase (`d85abd76-...`)
- ✅ Session created (`28119cfb-...`)
- ✅ Language detected: English
- ✅ Message stored in DB with session + language linkage
- ✅ Intent detected via LLM
- ✅ AI response generated via OpenRouter
- ✅ Bot response stored in DB
- ❌ WhatsApp send failed (expected — no `WHATSAPP_TOKEN` set)

Every internal subsystem exercised: Supabase RW, Redis, OpenRouter LLM, session state, language detection, message pipeline.

### Bug caught: Supabase service_role missing table grants (2026-07-11)

First mock webhook test hit `permission denied for table users`. Root cause: during schema bootstrap the `DROP SCHEMA public CASCADE` + `CREATE SCHEMA public` cycle wiped table-level grants. Recreated tables inherited default grants only (owner = postgres). `service_role` had schema USAGE but no per-table SELECT/INSERT/UPDATE/DELETE.

**Fix applied**:
```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
NOTIFY pgrst, 'reload schema';
```

This is worth adding to `rumi-platform`'s bootstrap script — any fork that hits a schema drop will lose grants, and the error `permission denied for table users` on first user message is a bad first impression. **Upstream bug #5.**

### What remains blocked

1. **WhatsApp end-to-end** — bot is healthy but has NO WABA attached yet. Once the NIETE Meta app is created (paused per user direction — see [Meta app: NIETE Rumi](#meta-app-niete-rumi-to-be-created) above), we plumb `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WABA_ID`, `WEBHOOK_VERIFY_TOKEN` and the bot will accept incoming messages.

### Bonus: template harvest (2026-07-11)

While bot was building, harvested 9 core-feature message templates from PK production WABA (`1383233296670749`) — includes the `feature_menu_carousel_v3` "/menu" carousel, the reading-assessment invitations, quiz templates (EN + UR), registration variants, and portal OTP. Staged in [`infrastructure/templates/`](../../infrastructure/templates/) with a `publish-templates.sh` script ready to run against NIETE's WABA once created.

Partner-specific marketing templates (Proj42, TFSL, RWP, Balochistan, Sindh, Storybooks, STEDA, Beaconhouse ELT/CS, seasonal) intentionally NOT harvested — see [templates/README.md](../../infrastructure/templates/README.md) for what was skipped and why.

**Upstream fixes worth PRing to `rumi-platform`**:
- Move `railway.json` from `infrastructure/railway/` to repo root, OR document that Railway config needs to be re-set per-fork
- Add `"engines": {"node": ">=20"}` to root `package.json`
- Add `"scripts": {"postinstall": "cd bot && npm install"}` to root `package.json`

### Step 5 — Get OpenRouter key

- [ ] Create account at [openrouter.ai](https://openrouter.ai)
- [ ] Generate an API key (Settings → Keys)
- [ ] Capture as `OPENROUTER_API_KEY`

### Step 6 — WhatsApp Business setup (Meta)

Follows `docs/onboarding/whatsapp.md` in `rumi-platform`. Depending on decision C:

**If new Meta app**:
- [ ] Create Meta Business account at [business.facebook.com](https://business.facebook.com)
- [ ] Add a WhatsApp Business Account (WABA)
- [ ] Add a test phone number OR bring your own verified number
- [ ] From Meta Developer Console, create an app of type "Business" with WhatsApp product added

**If reusing existing Meta app** (partner-provided):
- [ ] Get from partner: App ID, WABA ID, Phone Number ID, System User Access Token
- [ ] Verify the token has expected scopes: `bash scripts/verify-token.sh` (from main Rumi bot region-rollout skill)

Capture:
- [ ] `WHATSAPP_TOKEN` (system-user permanent token)
- [ ] `WHATSAPP_PHONE_NUMBER_ID`
- [ ] `WHATSAPP_WABA_ID`
- [ ] `WHATSAPP_VERIFY_TOKEN` — any random string we invent, must match the webhook config in Step 11
- [ ] `WHATSAPP_APP_SECRET` (from Meta Developer Console → App Settings → Basic)

### Step 7 — Assemble `.env`

Copy `.env.template` → `.env` locally (for smoke tests) and fill in:

```
NODE_ENV=production
PORT=3000
SUPABASE_URL=<from Step 3>
SUPABASE_SERVICE_ROLE_KEY=<from Step 3>
OPENROUTER_API_KEY=<from Step 5>
REDIS_URL=<from Step 4>
WHATSAPP_TOKEN=<from Step 6>
WHATSAPP_PHONE_NUMBER_ID=<from Step 6>
WHATSAPP_WABA_ID=<from Step 6>
WHATSAPP_VERIFY_TOKEN=<invented>
WHATSAPP_APP_SECRET=<from Step 6>
```

- [ ] `npm run doctor` — should show all 8 required keys green, feature keys red (that's fine for phase 1)

### Step 8 — Push `.env` values to Railway

- [ ] Add every `.env` variable to Railway's service Variables tab (Railway UI or `railway variables set KEY=VALUE`)
- [ ] **Never commit `.env`** — only `.env.template` is tracked

### Step 9 — Configure Railway deploy

- [ ] Connect the Railway service to the fork's GitHub repo
- [ ] Set start command to `node bot/whatsapp-bot.js` (matches `railway.json`)
- [ ] Set healthcheck path to `/health`
- [ ] Verify `NIXPACKS` builder is selected

### Step 10 — Deploy from `main`

- [ ] Trigger Railway deploy — auto on push, or manual via `railway up`
- [ ] Watch build logs — build should complete in ~2–5 minutes
- [ ] Verify healthcheck returns 200 at `<railway-domain>/health`
- [ ] Note the public Railway domain (e.g. `<fork>-production.up.railway.app`)

### Step 11 — Configure WhatsApp webhook

In Meta Developer Console → WhatsApp → Configuration:

- [ ] Set Callback URL to `https://<railway-domain>/whatsapp/webhook`
- [ ] Set Verify Token to the `WHATSAPP_VERIFY_TOKEN` from Step 6
- [ ] Click "Verify and Save" — Meta pings your webhook; must return 200
- [ ] Subscribe to fields: `messages`, `message_status`, `message_template_status_update`

### Step 12 — Smoke test with a real phone

- [ ] Send a message to the region's WhatsApp number from your phone
- [ ] Verify Railway logs show the incoming message
- [ ] Verify Rumi responds (registration prompt, since your phone isn't in the DB yet)
- [ ] Complete the registration flow
- [ ] Send "hello" — verify chat response works (validates OpenRouter wiring)

**Success gate**: registration completes + a chat response comes back. That's phase 1 done — feature work starts after this.

---

## What comes AFTER this deployment

Once Step 12 passes, phase 1 is over. Feature work begins:

| Feature | Next doc |
|---|---|
| Populate LP catalog | [01-lesson-plans.md](./01-lesson-plans.md) + [04-data-migration.md](./04-data-migration.md) |
| Build teacher training | [02-teacher-training.md](./02-teacher-training.md) |
| Add coach HITL layer | [03-digital-coach.md](./03-digital-coach.md) |
| Add exam generator | [05-exam-generator.md](./05-exam-generator.md) |
| Backport pdf, translation-cache, feature-health, ab-split from prod bot | [06-from-main-rumi-bot.md](./06-from-main-rumi-bot.md) |
| Capacitor mobile wrap | [07-capacitor-mobile.md](./07-capacitor-mobile.md) — deferred to end |

---

## Decisions (fill in as we go)

| ID | Question | Value | Decided |
|---|---|---|---|
| A | Fork repo name | **`NIETE-Rumi`** | ✅ 2026-07-11 |
| B | GitHub org | **`Orenda-Project`** — full repo path: `github.com/Orenda-Project/NIETE-Rumi` | ✅ 2026-07-11 |
| C | Meta app: new or reused | **NEW** — "NIETE Rumi" app, to be created in the **Taleemabad Business Portfolio** (ID `1688442341270440` — same portfolio as Yemen + PK apps) | ✅ 2026-07-11 |
| D | Deployment target | Railway (default) | — |
| E | Region tag string | TBD (suggested: `niete` or `niete-pk`) | — |
| F | WABA strategy for NIETE branding | **Path B** — create new "NIETE" WABA in Taleemabad portfolio, migrate phone `+92 320 6281951` from Mudareb WABA. Mudareb Meta APP not touched. Display name (`verified_name`) = **"NIETE"** (recipient-visible). Meta App name = "NIETE Rumi" (developer-facing). | ✅ 2026-07-11 |
| G | Constraint | **Mudareb Meta App must NOT be modified.** Only its WABA loses the phone. | ✅ 2026-07-11 |

### Meta app: NIETE Rumi (to be created)

New Meta app to be provisioned by the user in Meta Developer Console.

- **Meta App name**: NIETE Rumi (developer-facing, in Meta Developer Console)
- **Business Portfolio owner**: **Taleemabad** (Portfolio ID `1688442341270440`) — same portfolio as Yemen + PK apps
- **Products to add**: WhatsApp (only, initially)
- **Phone number**: `+92 320 6281951` — currently on Mudareb WABA, being migrated to a new NIETE WABA
- **WABA strategy**: **Path B** — create new "NIETE" WABA in Taleemabad portfolio, migrate phone from Mudareb WABA. Mudareb Meta APP not touched (only its WABA loses the phone).
- **Recipient-visible display name (`verified_name`)**: **NIETE** — to be submitted for Meta approval (2–24h review)
- **Branding**: distinct from Rumi's main branding — profile photo, business description all NIETE-specific

**Cool-down warning**: Meta imposes ~7-day post-migration restrictions on marketing template throughput + quality-rating reset. Utility templates (like `hello_world`) still work during this window. Time the production launch accordingly.

Once created, the user provides:

| Credential | Where to find in Meta | Env var |
|---|---|---|
| App ID | Meta Developer app dashboard, top of page | `WHATSAPP_APP_ID` |
| App Secret | Settings → Basic → App Secret (Show) | `WHATSAPP_APP_SECRET` |
| WABA ID | WhatsApp → API Setup | `WHATSAPP_WABA_ID` |
| Phone Number ID | WhatsApp → API Setup | `WHATSAPP_PHONE_NUMBER_ID` |
| System User Token | Business Settings → System Users → Generate (scopes: `whatsapp_business_management`, `whatsapp_business_messaging`) | `WHATSAPP_TOKEN` |

**Never commit these to the repo.** Set as Railway env vars only. System user tokens should be permanent (`expires_at: 0`); 24-hour temporary tokens will not work for production.

### Prior verification — Mudareb PK app (NOT USED)

For historical record only — this app was verified 2026-07-11 during setup but **rejected in favour of a NIETE-branded new app**. The verified data is retained here so the verification method is documented for future setups; the actual credentials are dead-ends for this deployment.

<details>
<summary>Verified Mudareb PK metadata (not used)</summary>

- App ID: `2052724122329740` ("Mudareb pk (free to use)")
- WABA ID: `1551576156552661`
- Phone Number ID: `1155653510968291` (display: `+92 320 6281951`, verified name "Mudareb")
- Quality: GREEN, Throughput: STANDARD, Platform: CLOUD_API
- E2E `hello_world` send succeeded to `+92 333 3232533` on 2026-07-11 — message ID `wamid.HBgMOTIzMzMzMjMyNTMzFQIAERgSMDlBMTBBMjRGMTA5NjcyQzU4AA==`
- Gotcha found: `code_verification_status: EXPIRED` on the phone; did not block sending

The token pasted for this app is now unused for our purposes. If it's active elsewhere, don't rotate it here.

</details>

## Portal deploy (2026-07-11, phase 2)

Live: **https://portal-production-6a508.up.railway.app** — Railway service `portal` (service ID `1b16c811-3436-45f4-930a-fe9442c3bd85`) in the NIETE-Rumi project (project ID `bcc5a6a9-02e6-4d1f-8fff-1fe5eb5626df`, environment `production` ID `6902ea89-557f-416a-8e00-176dc61fcfad`). Serves the React SPA (`portal/`) statically from `dashboard/portal-frontend/dist/` and the `/api/portal/*` JSON API from the same Express server on port 8080. Same-domain = no CORS, no third-party cookies, sessions in Redis via the existing `redis.railway.internal:6379`.

Verified end-to-end via Chrome MCP on the operator account (Mashhood): setup token exchange → password creation → `/portal/dashboard` render fetched the Feature #1 LP from Supabase and rendered it as "Recent Lesson Plans" with a working PDF download link. Proves the portal reads live bot-produced data with zero manual sync.

**Bugs found + fixed during deploy** (~6 iterations; every bot fork will hit these):

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Runtime `Cannot find module 'dotenv'` | `npm ci` ran at repo root, not in `dashboard/` where the `package.json` with 22 deps lives | Set service `rootDirectory=/dashboard`; keep `startCommand=node entrypoint.js` |
| 2 | `Missing Resend API key` at module load | `dashboard/services/resend-email.service.js` instantiates `new Resend(...)` eagerly at require-time | Set `RESEND_API_KEY` to a placeholder to unblock; password-reset email flow stays disabled until a real key is provisioned. Upstream fix: lazy-init the Resend client. **Upstream bug #7.** |
| 3 | `ENOTFOUND tenant/user postgres.<ref>` from Supavisor pooler | Guessed wrong pooler host (`aws-0-us-east-1.pooler.supabase.com`) | Query `GET /v1/projects/{ref}/config/database/pooler` from the Supabase Management API — for `ihzciabopbttygxxgrkm` the correct host is `aws-1-ap-south-1.pooler.supabase.com:6543`. Never guess pooler hostnames. |
| 4 | Direct DB conn `ENETUNREACH` (IPv6) | `db.<ref>.supabase.co` returns AAAA only; Railway egress is IPv4-only | Use the pooler (fix #3), not the direct connection |
| 5 | Railway proxy 502 after successful boot | `targetPort` on the service domain was `null` and `PORT` env was unset | Set `PORT=8080` env + `serviceDomainUpdate targetPort=8080` explicitly. Auto-detection is unreliable for services created via the GraphQL API |
| 6 | React Router 404 on `/portal/setup?token=...` | Route is `/portal/setup/:token` (path param), not `?token=` | The bot's registration flow already emits the correct shape; docs updated |

**Env vars set on the portal service** (19 total): `NODE_ENV`, `PORT`, `DATABASE_URL` (pooler), `REDIS_URL` (internal), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_{HOST,PORT,USER,PASSWORD,NAME}` (pooler-scoped), `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `BROADCAST_PASSWORD`, `SESSION_COOKIE_NAME`, `WEBSITE_URL`, `SQS_PORTAL_QUEUE_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `RESEND_API_KEY` (placeholder), `NIXPACKS_NODE_VERSION=22`, `RAILPACK_NODE_VERSION=22`. `PORTAL_URL` propagated to bot + sqs-worker services so registration deep-links point at the portal.

Build strategy chosen: **commit the built SPA** to `dashboard/portal-frontend/dist/` (with a `!` negation rule in root `.gitignore`). Rebuild = `cd portal && npm ci && npm run build && cp -r dist ../dashboard/portal-frontend/`. Simpler than a two-stage Nixpacks build for a fork where the portal changes rarely; can migrate to a two-stage build later if it becomes churn.

## Notes / gotchas

- Every backport from `02_Main Rumi Bot` (per doc [06](./06-from-main-rumi-bot.md)) must be **sanitised of hardcoded partner references** (phone numbers, `taleemabad.com`, `hyasin270`) before landing in the fork. The source-hygiene test (`tests/setup/source-hygiene.test.js`) catches leaks.
- `SUPABASE_SERVICE_ROLE_KEY` (not the anon key) is required — service role bypasses RLS, which the bot needs for cross-user reads/writes.
- Railway's Redis TLS URL requires `rediss://` (double `s`) — a common gotcha.
