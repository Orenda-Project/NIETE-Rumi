# NIETE WhatsApp Flows

**What's here**: the Flow JSON assets currently deployed to NIETE's WABA (`1551576156552661`). One file per active Flow. When we edit the JSON, we upload the new revision via Meta's `POST /{FLOW_ID}/assets` and re-publish.

**Naming**: `<flow-key>.json` matches the endpoint route (`/api/flows/<flow-key>`) and the `<X>_FLOW_ID` env var pattern (uppercase, `_FLOW_ID` suffix).

## Deployed Flows

| Flow | JSON | Live Flow ID | Env var | Status |
|---|---|---|---|---|
| Registration | `registration.json` | `1735936197748957` | `REGISTRATION_FLOW_ID` | 🟢 PUBLISHED (Rumi→NIETE copy edited 2026-07-11) |
| Coaching | (pending) | — | `COACHING_FLOW_ID` | ❌ Not yet ported |
| Attendance setup | (pending) | — | `ATTENDANCE_SETUP_FLOW_ID` | ❌ Not yet ported |
| Attendance marking | (pending) | — | `ATTENDANCE_MARKING_FLOW_ID` | ❌ Not yet ported |
| Quiz | (pending) | — | `QUIZ_FLOW_ID` | ❌ Not yet ported |

## Editing an existing Flow

1. Edit the local `<flow-key>.json`.
2. Re-upload as a new asset revision:
   ```bash
   TOKEN=$(grep '^WHATSAPP_TOKEN=' ../../.env | cut -d= -f2-)
   FLOW_ID=<the-live-id>
   curl -sS -X POST "https://graph.facebook.com/v20.0/${FLOW_ID}/assets" \
     -H "Authorization: Bearer ${TOKEN}" \
     -F "name=flow.json" \
     -F "asset_type=FLOW_JSON" \
     -F "file=@<flow-key>.json;type=application/json"
   ```
3. Re-publish:
   ```bash
   curl -sS -X POST "https://graph.facebook.com/v20.0/${FLOW_ID}/publish?access_token=${TOKEN}"
   ```
4. Commit the JSON change.

Meta versions Flow assets automatically — no need to bump a version number in the JSON. The DRAFT → PUBLISHED cycle is instant for non-carousel changes; carousel/media-heavy edits take 1-24h for Meta review.

## Adding a new Flow (Coaching, Attendance, Quiz, etc.)

Follow the 9-step procedure in [docs/migration/08-launch-checklist.md § Flow re-registration pattern](../../docs/migration/08-launch-checklist.md#the-flow-re-registration-pattern-fully-worked-example--registration-2026-07-11). The encryption keypair + Meta pubkey registration are already done (Registration set them up on 2026-07-11), so each subsequent Flow is a 6-step process:

1. Fetch source Flow JSON from PK: `GET /{PK_FLOW_ID}/assets → download_url`
2. Create Flow: `POST /{NIETE_WABA_ID}/flows` with `name`, `categories`, `endpoint_uri`
3. Upload JSON: `POST /{NEW_FLOW_ID}/assets` (multipart)
4. Save `<X>_FLOW_ID` env var on the NIETE bot Railway service, redeploy
5. Publish: `POST /{NEW_FLOW_ID}/publish`
6. Chrome MCP verify: trigger via the bot's slash command, click "Get started", check the first screen renders.

Commit the local JSON here and update the table above.

## Business-name-derived copy

Two strings in every Flow render come from Meta's WABA business name, not the JSON — they cannot be edited via asset upload:

- **"Powered by \<name\>"** on the Flow trigger message
- **"Managed by \<name\>"** in the WebView footer

Currently both say "Rumi" / "Mudareb" because the WABA still has its original name from the Mudareb-adoption. They'll flip to "NIETE" the moment you rename the WABA in Meta Business Manager (a manual browser task on your side).
