# Connecting WhatsApp

WhatsApp is the only setup step with eligibility rules, so it's where people get stuck. Good news: **you can have a working bot in ~10 minutes, for free, with no business verification** — using Meta's free *test number*. Do that first. Move to a production number when you're ready to message real teachers.

This produces the four values the bot needs: `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WEBHOOK_VERIFY_TOKEN`, `WABA_ID`.

> Verified against Meta's docs as of May 2026. Meta's console wording shifts — re-check the menu labels as you go.

---

## Part 1 — Try it in ~10 minutes (free test number)

No cost, no verification, you can message up to 5 of your own numbers.

1. Go to **developers.facebook.com** → log in → **My Apps** → **Create App**.
2. Choose the **Business** type → name the app → create.
3. On the app dashboard, find **WhatsApp** → **Set up**. Meta automatically creates a **WhatsApp Business Account (WABA)** and a **free test phone number**.
4. Open **WhatsApp → API Setup**. You'll see:
   - **Phone number ID** → `PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** → `WABA_ID`
   - a **temporary access token** (valid 24h) → use as `WHATSAPP_TOKEN` for now (replace with a permanent one in Part 2).
5. Under **To**, add your own phone number(s) as recipients (up to 5) — each confirms via a code in WhatsApp.
6. **App Secret:** app dashboard → **App Settings → Basic** → reveal **App Secret** (the bot uses it to validate incoming webhooks).
7. **Choose your Verify Token:** make up any random string (e.g. a UUID). You'll paste the *same* string into Meta's webhook config and into the bot's `WEBHOOK_VERIFY_TOKEN`.

### Wire the webhook
8. Deploy the bot so it has a public URL (e.g. on Railway), or use a tunnel (ngrok) for local testing.
9. In **WhatsApp → Configuration → Webhook**, click **Edit**:
   - **Callback URL** = `https://<your-bot-domain>/webhook` (check the bot's route).
   - **Verify token** = the string from step 7.
   - Click **Verify and save** — Meta GET-pings your URL with the token; the bot echoes the challenge back.
10. Click **Manage** and **subscribe** to the **`messages`** field.
11. Send "Hi" from one of your added recipient numbers → the bot should reply. ✅

> The temporary token expires in 24h. Before it does, mint a permanent one (Part 2, step C) so the bot doesn't go dark.

---

## Part 2 — Go to production (real number, real teachers)

When you're ready to message anyone (not just your 5 test recipients):

**A. Add your own phone number**
- In **WhatsApp → API Setup → Add phone number**, register a number you control.
- **It must NOT currently be active on regular WhatsApp or the WhatsApp Business app.** Use a fresh SIM or a VoIP/landline number that can receive an SMS or voice code. (If the number was in use, delete its WhatsApp account first.)
- Verify it via the SMS/voice code, and set a **display name** (Meta reviews it — avoid generic words / mismatches or it gets rejected).

**B. Complete Business Verification**
- In **Meta Business Settings → Security Center / Business Verification**, submit legal-entity documents (incorporation / utility bill / tax certificate; NGOs use registration/charity docs) that **match** your Business Manager's legal name + address.
- No fixed SLA — hours to several days; it stalls on document mismatches. Verification lifts the test caps and raises your messaging limits.

**C. Mint a permanent access token** (replaces the 24h token)
- **Business Settings → Users → System Users** → **Add** a system user (Admin).
- **Add Assets** → assign your **WABA** with **Manage** permission.
- **Generate new token** → select the app → scopes **`whatsapp_business_messaging`** + **`whatsapp_business_management`** → generate → copy → this is your permanent `WHATSAPP_TOKEN`.

You now have all four production values. Update `.env` and redeploy.

---

## What to know before you scale (gotchas)

- **24-hour service window:** when a teacher messages you, a 24h window opens during which the bot's **free-form replies are free**. Outside it you must send an **approved template** (billed). Rumi is built around this — most teacher-initiated conversations cost nothing.
- **Messaging limits:** new numbers start at **250 business-initiated conversations / 24h**, auto-raising to 1k → 10k → 100k → unlimited as you verify + keep a good quality rating + sustain volume.
- **Quality rating** (green/yellow/red): driven by user blocks/reports + template quality. A low rating throttles you and blocks limit upgrades.
- **Pricing (2026):** per-message, by category (marketing / utility / authentication / service) × country, billed on delivery. **Service replies in the 24h window are free.** A bot that mostly answers within the window is cheap; broadcasts (templates) are where cost grows. See the [cost guide](../cost-guide.md).

---

## Can't pass Business Verification? Use a BSP (360dialog)

If verification is a blocker, or you'd rather not run your own number, a Business Solution Provider can host the WABA while you keep your own webhook:

- **360dialog** — flat ~€49/$50 per number/month, **no per-message markup**, bring-your-own-number (incl. migrating a number already on the WhatsApp Business app), and you point the **webhook at your own server**. No lock-in.
- Its API differs slightly from raw Cloud API, so the bot may need a thin adapter (not included yet — open an issue if you need it).
- Avoid per-message-markup BSPs (e.g. Twilio production) for a self-hosted bot unless you're already on them. Twilio's *sandbox* is, however, a fast way to demo without any approval.

---

## Quick reference — the four values
| Value | Where it comes from |
|-------|---------------------|
| `WABA_ID` | WhatsApp → API Setup → WhatsApp Business Account ID |
| `PHONE_NUMBER_ID` | WhatsApp → API Setup → Phone number ID |
| `WHATSAPP_TOKEN` | API Setup (temp 24h) → then a System User permanent token (Part 2C) |
| `WEBHOOK_VERIFY_TOKEN` | A random string you invent, pasted into both Meta's webhook config and `.env` |

Next: get the rest of your [API keys](api-keys.md), then register your interactive Flows + message templates against the WABA (see [SETUP.md](../../SETUP.md)).
