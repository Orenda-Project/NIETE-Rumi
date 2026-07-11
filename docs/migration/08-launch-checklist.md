# 08 — Launch Checklist

**Status**: 🟢 Living checklist — as of 2026-07-11 the infrastructure is deployed and the first feature (LP generation) is verified. This doc enumerates what remains between "deployed" and "we can hand it to real NIETE teachers."

**Companion docs**: [DEPLOYMENT.md](./DEPLOYMENT.md) (what's done) · [00-scope-and-decisions.md](./00-scope-and-decisions.md) (architectural givens) · [Track docs 01-07](./README.md) (per-feature migration plans)

---

## What's already live (2026-07-11)

| Layer | Artifact | Verified |
|---|---|---|
| WhatsApp bot | `+92 320 6281951` on Meta App `2052724122329740` (Mudareb-adopted) | ✅ real webhook → bot → real Meta reply |
| Async workers | `sqs-worker` service on Railway | ✅ LP job processed |
| Redis | `redis.railway.internal` | ✅ session store works |
| Supabase | Project `ihzciabopbttygxxgrkm` (ap-south-1), 76 tables + 5 MVs | ✅ read/write both proven |
| Web portal | https://portal-production-6a508.up.railway.app | ✅ auth + dashboard + LP display all working |
| WhatsApp templates | 4 launch-scoped submitted; 3 APPROVED, 1 PENDING | 🟡 waiting Meta on `feature_menu_carousel_v3` |
| Branding | NIETE logo + charcoal/green palette + fonts on portal | ✅ verified in Chrome |

Feature verifications so far: **Feature #1 (LP generation, English request)** — end-to-end WhatsApp → LLM → SQS → Gamma → R2 → WhatsApp document delivery. Every other feature is theoretically ready (code is deployed) but not yet exercised on this WABA.

---

## Launch blockers (must clear before real teachers land)

### Meta / WABA (out-of-band, 24h–2wk calendar time)

1. **Rename Meta App** `Mudareb pk` → `NIETE Rumi` — manual in Meta Business Manager (~10 min operator time; Meta approval instant for name change)
2. **Rename WABA** `Mudareb` → `NIETE` — manual; needs `business_management` scope; instant.
3. **Display name registration** — submit `NIETE` as the WhatsApp Business display name for phone `1155653510968291`. Meta review typically 2-24h. Until approved, teachers see `+92 320 6281951` as the sender name.
4. **Business verification** — raise the account's messaging tier from 250 conversations / 24h (unverified) to 1000+ (verified). Meta requires business docs (registration certificate, address proof). NIETE's status as a federal directorate should qualify — but the paperwork submission is manual.
5. **Advanced access for `message_status` + `message_template_status_update` webhook fields** — currently the app only receives `messages` field. Meta app review required for the other two. Blocks any delivery-status logging + template-approval automation.
6. **`feature_menu_carousel_v3` approval** — submitted 2026-07-11, PENDING, expected within 24h.

### Content & policy

7. **Privacy policy** — Meta requires a public URL. Must cover WhatsApp data collection, message retention, teacher data usage.
8. **Terms of service** — same requirement.
9. **Data processing agreement with NIETE** — since we're storing teacher data (phone, name, LPs generated), the contractual relationship with NIETE about ownership + retention needs paper.

### Stakeholder

10. **NIETE primary contact identified** — who's the person on NIETE's side who owns Rumi rollout? (Contact form on niete.edu.pk gives `contact@niete.edu.pk` — that's the org, not the person.)
11. **Sign-off on portal look/feel + first-feature scope** — before we invite real teachers, NIETE should see the portal, approve the branding, and lock feature scope for phase 1.

---

## Feature verification queue (before opening to teachers)

Each of these needs a Chrome MCP / whatsapp-web-e2e run on the NIETE bot before we can say "this feature works for NIETE users":

| # | Feature | Depends on | Status |
|---|---|---|---|
| 1 | LP generation (text request) | — | ✅ verified 2026-07-11 |
| 2 | Registration Flow (WhatsApp Flow) | RSA keypair + Meta pubkey registration + Flow JSON on NIETE WABA | ✅ **verified 2026-07-11** — Flow `1735936197748957` PUBLISHED, WebView opens, encryption handshake proven E2E |
| 3 | Pic-to-LP (image → LP via Textract + Kie.ai) | LP generation working (✅), image analysis env vars (already set) | 🟡 needs test send |
| 4 | Coaching (classroom observation) | Coaching Flow re-registered on NIETE WABA | ❌ Flow ID re-registration (pattern below) |
| 5 | Quiz feature | Quiz templates approved (✅), quiz-generator Flow re-registered | 🟡 template ready, Flow needs re-reg |
| 6 | Attendance (Flow-based) | Attendance Flow re-registered × 2 (setup + marking) | ❌ Flow ID re-registration |
| 7 | Homework | LP generation (✅), worksheet render (already deployed) | 🟡 needs test send |
| 8 | `/menu` command | `feature_menu_carousel_v3` approval (PENDING) | 🟡 waiting Meta |
| 9 | Broadcast to a cohort | Approved templates (✅ for 3 utility ones) | 🟡 needs test broadcast to 1-2 users |

**The Flow-re-registration pattern (fully worked example — Registration, 2026-07-11)**. Encryption handshake is the load-bearing part; nail it once and every other Flow uses the same wiring.

1. **Generate RSA 2048 keypair** — `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem && openssl rsa -in priv.pem -pubout -out pub.pem`. Base64-encode the private for env storage: `base64 -i priv.pem | tr -d '\n'`.
2. **Set `FLOW_PRIVATE_KEY_B64` on the bot Railway service.** The bot's `flow-encryption.service.js` reads this and decrypts every inbound Meta payload.
3. **Register the public key with Meta** for the phone number: `POST /v20.0/{PHONE_NUMBER_ID}/whatsapp_business_encryption` with body `business_public_key=<pubkey-PEM>`. Verify with `GET .../whatsapp_business_encryption` → `business_public_key_signature_status: VALID`.
4. **Fetch the source Flow's JSON asset from PK** — `GET /v20.0/{PK_FLOW_ID}/assets?access_token=$PK_TOKEN` returns `download_url`; download to a local file.
5. **Create the Flow on NIETE's WABA** — `POST /v20.0/{NIETE_WABA_ID}/flows` with `{name, categories, endpoint_uri}` where `endpoint_uri = https://bot-production-2cb6.up.railway.app/api/flows/<flow-name>`. Response gives the new Flow ID.
6. **Upload the JSON as an asset** — `POST /v20.0/{NEW_FLOW_ID}/assets` multipart with `name=flow.json`, `asset_type=FLOW_JSON`, `file=@<downloaded>.json`. Meta validates + returns `validation_errors: []` (or a list to fix).
7. **Set the Flow ID as an env var on the bot service** — e.g. `REGISTRATION_FLOW_ID=<new_id>` — and redeploy the bot so the new value is picked up.
8. **Publish** — `POST /v20.0/{NEW_FLOW_ID}/publish` moves status DRAFT → PUBLISHED. From this point Meta will render the Flow when the bot sends a `flow` interactive message.
9. **Verify E2E** — trigger the Flow from a WhatsApp phone (e.g. `/register`), click "Get started", confirm the first screen renders in the WebView. Success = encryption handshake works.

**Known cosmetic post-migration:**
- **Screen copy** (e.g. "Welcome to Rumi!") is hardcoded in the Flow JSON. Rebrand by editing the downloaded JSON, uploading a new asset revision, and re-publishing.
- **"Managed by <BusinessName>" footer** on the Flow WebView is auto-sourced from the WABA's business display name — flips to "Managed by NIETE" once you rename the WABA in Meta Business Manager (currently on your manual TODO).

**Coaching, Quiz, Attendance, Settings Flows follow the same 9 steps** — the encryption key + Meta pubkey registration are already done (Registration set them up), so each subsequent Flow is a 6-step process (skip steps 1-3).

---

## Content migration (the "empty portal, no LPs yet" problem)

The bot works on-demand — teachers request LPs, they generate. But if we want the portal to show pre-populated content on first login (rather than the current "0 LPs" for a new user), we need to bulk-seed. That's covered by:

- [Track 04: data-migration](./04-data-migration.md) — ETL from Taleemabad's `fde_production` schema → Rumi Supabase. 119K LPs available as source. Options in the doc: (A) render HTML → PDF in migration pipeline (~2-8h, one-time), (B) store HTML, render on-demand, (C) deliver as formatted WhatsApp text.
- [Track 02: teacher-training](./02-teacher-training.md) — 758 training modules + 5,652 quiz questions from Taleemabad. Requires a new nav tab in the portal (deferred per operator instruction).
- [Track 03: digital-coach](./03-digital-coach.md) — coaching HITL layer.

**Track 04 is the highest-leverage** — one migration seeds LPs, training, quiz, coaching material all at once. Decision needed: HTML-render option (A/B/C).

---

## Infrastructure hardening (nice-to-have before scale)

| Item | What breaks without it | Effort |
|---|---|---|
| Custom subdomain (`portal.niete.pk` or similar) | Portal URL looks unofficial to teachers | 30 min (needs NIETE DNS) |
| Axiom / structured log destination | Debugging is Railway-logs-only (grep, no aggregation) | ~2h to wire Axiom or similar |
| Sentry / error tracking | Bot exceptions log to Railway but no alerting | ~1h |
| Rate limiting per-user | A misbehaving teacher can spam the bot; OpenRouter costs accrue | ~2h |
| Backup drill (Supabase PITR) | Rely on Supabase default backups; never tested restore | ~1h to prove it works |
| Marketing landing page at `/` | Currently the Rumi open-source marketing splash shows if not on `portal.` subdomain — teachers hitting the root URL see confusing Rumi copy | 1-3h depending on ambition |
| 404 page branding | Generic React NotFound with no NIETE styling | 30 min |
| CI on the fork | Every push goes straight to Railway with no test gate | ~1h (copy `.github/workflows/` from `rumi-platform`) |

---

## Post-launch (operational)

- Weekly usage report (unique users × messages × LPs generated) — could reuse `dashboard/routes/dashboard.routes.js`
- Meta template renewal — templates auto-pause after 30 days of no use; watch for that
- WhatsApp health monitoring — Meta's phone_number_id status can flag as `FLAGGED` from spam signals
- User feedback intake — some path for teachers to report bugs (currently only via WhatsApp DM to the bot)

---

## Suggested next-play order

Assuming NIETE stakeholder is a normal sponsor + we want a "friends & family" invite phase before public launch:

1. **This week** — Register the 4 core Flows on NIETE WABA (registration, coaching, quiz, attendance); verify each end-to-end via Chrome MCP; queue Meta business verification paperwork.
2. **Next week** — Rename App + WABA; submit display name; get NIETE stakeholder to review portal + brand; pick Track 04 delivery model (A/B/C).
3. **Following week** — Run Track 04 ETL; open portal to 5-10 pilot teachers from NIETE; watch Railway logs + `dashboard/routes/dashboard.routes.js` metrics.
4. **Later** — Custom subdomain; Axiom; Sentry; broadcast to the wider NIETE roster.

That sequencing keeps Meta paperwork on its own calendar-time track while we do the code/config work in parallel.
