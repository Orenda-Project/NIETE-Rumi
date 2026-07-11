# Deployment — Fork Setup & Initial WhatsApp Connection

**Status**: 🟡 Meta setup **paused** — user will complete WABA migration + app creation later. Fork name locked in as `NIETE-Rumi` under `Orenda-Project`. Moving to fork creation next.

**Customer**: NIETE — National Institute of Education, Pakistan.
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

### Step 3 — Create Supabase project

- [ ] Create free-tier project at [supabase.com](https://supabase.com), region closest to target users
- [ ] Paste `exec_sql` helper (see SETUP.md Step 2) in SQL Editor once
- [ ] `npm run bootstrap:db` — applies schema + RLS + seed
- [ ] `infrastructure/supabase/verify-schema.sql` — all checks show PASS
- [ ] Capture `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from Settings → API

### Step 4 — Create Railway project

- [ ] Create Railway project (empty)
- [ ] Add **Redis plugin** — copy `REDIS_URL` from its Variables tab
- [ ] Leave the bot service unconfigured for now — deploys in Step 10

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

## Notes / gotchas

- Every backport from `02_Main Rumi Bot` (per doc [06](./06-from-main-rumi-bot.md)) must be **sanitised of hardcoded partner references** (phone numbers, `taleemabad.com`, `hyasin270`) before landing in the fork. The source-hygiene test (`tests/setup/source-hygiene.test.js`) catches leaks.
- `SUPABASE_SERVICE_ROLE_KEY` (not the anon key) is required — service role bypasses RLS, which the bot needs for cross-user reads/writes.
- Railway's Redis TLS URL requires `rediss://` (double `s`) — a common gotcha.
