# WhatsApp Message Templates — NIETE Fork

**Status**: 🟢 All 4 launch-scoped templates submitted 2026-07-11: `feature_menu_carousel_v3` (PENDING, 1-24h Meta review), `quiz_invitation_en/ur` + `readingtest_v2` (APPROVED same day). The other 5 harvested templates are deliberately skipped — see [Carousel re-upload](#carousel-re-upload-2026-07-11-session-2) for the scope reasoning.

Meta Cloud API templates are **per-WABA** — they don't cross between WhatsApp Business Accounts. To use PK's feature-menu carousel, reading-assessment invite, quiz invitations, etc. on NIETE Rumi, they must be re-submitted (and re-approved by Meta) on the NIETE WABA.

This folder holds the JSON definitions harvested from PK's production WABA (`1383233296670749`) so they can be replayed on NIETE's WABA once it's created.

## Source

Harvested 2026-07-11 from PK production WABA via Meta Graph API:

```bash
curl "https://graph.facebook.com/v20.0/1383233296670749/message_templates?access_token=$PK_WHATSAPP_TOKEN&limit=200&fields=id,name,status,category,language,components"
```

## Templates in this folder

| File | Category | Language | Has Carousel | Purpose |
|---|---|---|---|---|
| `feature_menu_carousel_v3.json` | MARKETING | en | ✅ | The "/menu" carousel — teachers pick a feature (LP, coaching, reading, quiz, etc.) |
| `video_style_selection.json` | MARKETING | en | ✅ | Video-generation style picker carousel |
| `readingtest_v2.json` | MARKETING | en | ❌ | Reading assessment invitation |
| `message_templates_readingtest_v2_marketing_e4c46.json` | MARKETING | en | ❌ | Reading test — alternate variant |
| `quiz_invitation_en.json` | MARKETING | en | ❌ | Quiz invitation (English) — sent to student's parent |
| `quiz_invitation_ur.json` | MARKETING | ur | ❌ | Quiz invitation (Urdu) — Roman/Nastaliq |
| `registration_v3.json` | MARKETING | en | ❌ | Teacher onboarding — latest version |
| `registrationv2_schoolname_included.json` | MARKETING | en | ❌ | Teacher onboarding — school-name variant |
| `rumi_portal_reset_otp.json` | AUTHENTICATION | en | ❌ | Portal password-reset OTP |

## Templates deliberately NOT harvested

The PK WABA has ~35 partner-specific and seasonal marketing templates that are **out of scope for NIETE**:

- `proj42_*` — Project 42 campaign
- `tfsl_*` — TFSL (Teachers for Successful Learning) partner
- `rwp_*` — Rawalpindi rollout campaigns
- `steda_*` — STEDA onboarding
- `sindh_*`, `balochistan_*` — other provincial rollouts
- `rumi_storybooks_*` — Rumi Storybooks feature (not shipping to NIETE per current scope)
- `happy_new_year_2026_*` — seasonal
- `broadcast_*`, `test_broadcast_*` — one-off broadcasts and CI tests
- `hots_module1_invite_v1`, `sl_user_group_meet_invite_v1` — other partner nudges

If any of these turn out to be needed for NIETE later, re-run the harvest command above and copy the relevant JSON here.

## Publishing to NIETE WABA (post-Meta-setup)

Once the NIETE WABA is created and its Access Token is available:

```bash
# Set these once
export NIETE_WHATSAPP_TOKEN='...'
export NIETE_WABA_ID='...'

# Run the publisher (script below)
bash publish-templates.sh
```

The publisher:
- Rewrites the `name` to `<name>` (or optionally prefixes with `niete_`) if you want to disambiguate on the NIETE WABA (not required — different WABAs mean same-name is fine)
- Submits each template via `POST /{waba-id}/message_templates`
- Reports `id` and initial `status: PENDING` for each
- Templates then move to `APPROVED` (usually within 1–24 hours) or `REJECTED` with a reason

**Meta's approval SLA**:
- UTILITY templates: typically minutes to hours
- MARKETING carousels: 1–24 hours (heavier review)
- Rejections common on first submission for: emoji misuse, marketing tone in a UTILITY category, missing sample values in variables

## Language plan for NIETE

NIETE is Pakistan-based. The English + Urdu variants harvested from PK cover the same audience. No new language variants needed for phase 1. If NIETE later requests additional languages (e.g. Sindhi, Balochi), we'll draft new template JSONs from scratch — templates aren't LLM-translatable without human review.

## Non-obvious gotchas

- **Meta Namespace propagation**: A template submitted to NIETE WABA appears in Meta's cache with a *different* namespace than PK's version, even if the JSON is byte-identical. That's normal — namespaces are per-WABA.
- **Carousel component ordering**: Meta rejects carousels with malformed component sequences. If a submission fails, diff the raw JSON against the PK original.
- **Variable examples**: MARKETING templates with `{{1}}`, `{{2}}` etc. require `example` values in the JSON. These are already in the harvested JSONs.
- **Rate limits**: Meta throttles template submission — space them out or accept some initial 429s and retry.

## Carousel re-upload (2026-07-11, session 2)

After the first-pass publish left `feature_menu_carousel_v3` blocked on "invalid media sample", ran a targeted re-upload against NIETE's App ID (`2052724122329740`) via Meta's resumable upload endpoint:

- Source videos: `06_Logs & Misc/Reports/Production/Onboarding Flow 18 Dec 2025/Feature_Videos/{01_Lesson_Plan,04_Video_Generation,02_Coaching,03_Reading}_Feature/**` (same set that seeded PK's carousel — 1.2 MB, 9.7 MB, 11.7 MB, 9.3 MB)
- Uploaded via `POST /{APP_ID}/uploads?file_length&file_type=video/mp4` → 4 fresh handles NIETE's WABA recognises
- Rewrote `feature_menu_carousel_v3.json`'s 4 `example.header_handle` arrays with the new handles
- Submitted: `id=1035306379358815, status=PENDING` (Meta's carousel review is 1-24h)

Script: `/tmp/reupload-carousel-media.py` (single-purpose; keep here as reference for the next fork).

**Templates deliberately NOT re-uploaded** (out of NIETE's launch scope):

| Template | Reason for skip |
|---|---|
| `video_style_selection` | Video generation feature is not launching. |
| `registration_v3` | Flow-based registration works without a template (proven end-to-end 2026-07-11). |
| `registrationv2_schoolname_included` | Same as above. |
| `message_templates_readingtest_v2_marketing_e4c46` | Reading Assessment feature is not launching. |
| `rumi_portal_reset_otp` | Portal password reset now uses Resend email flow (`dashboard/services/resend-email.service.js`). |

If any of these features move into scope later, follow the same pattern: source media → resumable upload → rewrite handles → resubmit.

## Publish attempt log (2026-07-11)

Ran `NIETE_WHATSAPP_TOKEN=... NIETE_WABA_ID=1551576156552661 bash publish-templates.sh` against the NIETE WABA (adopted-Mudareb app). Result: **3 accepted, 6 rejected**. Every rejection maps to the same underlying constraint — **rich-media handles + Flow-Navigate references + carousel media samples are WABA-scoped**. When we copy a template JSON from PK, those handles are dangling references on NIETE.

| Template | Result | Root cause | Fix path |
|---|---|---|---|
| `quiz_invitation_en` | ✅ PENDING (id `1735733497464759`) | — | Text-only, no media |
| `quiz_invitation_ur` | ✅ PENDING (id `1494667852463904`) | — | Text-only, no media |
| `readingtest_v2` | ✅ PENDING (id `1340625634212769`) | — | Text-only, no media |
| `feature_menu_carousel_v3` | ❌ error_subcode 2388215 "invalid media sample" | Carousel card 0 references PK-scoped image handle | Upload feature-card images to NIETE WABA media library, replace `example.header_handle` in the JSON |
| `video_style_selection` | ❌ error_subcode 2388215 same | Same — carousel media | Same — re-upload images to NIETE |
| `message_templates_readingtest_v2_marketing_e4c46` | ❌ error_subcode 2388202 "Navigate screen invalid" | References a Flow that only exists on PK | Create the reading-assessment Flow on NIETE first, then update the template's `navigate_screen` |
| `registration_v3` | ❌ error_subcode 2388273 "VIDEO header needs sample" | Video header points at PK-scoped video handle | Upload NIETE-branded registration video, replace video handle |
| `registrationv2_schoolname_included` | ❌ error_subcode 2388273 same | Same — video handle | Same — re-upload video |
| `rumi_portal_reset_otp` | ❌ error_subcode 2388042 "BODY component has unexpected `text` field" | Meta's AUTHENTICATION schema doesn't accept `text` in BODY component; harvested JSON was over-specified | Trim BODY to just `{"type":"BODY"}` — Meta injects a fixed OTP string. Also worth renaming to `niete_portal_reset_otp` since our Resend flow may replace this anyway |

**Pattern for the next fork:** the publisher should segment templates upfront into "portable" (text-only, no header media, no Flow navigation) vs "media-bound" (carousel, header IMAGE/VIDEO, or Flow-navigate). Auto-publish portable ones; queue media-bound ones behind a media-upload preflight step that re-registers each asset on the target WABA and rewrites handle references. Filed as **upstream `rumi-platform` bug #14**.

**Rejection-catalog priority for NIETE:**
- The 3 accepted templates cover **quiz + reading assessment intros** — the two features NIETE has scoped for launch. That's the important surface.
- `feature_menu_carousel_v3` matters for the `/menu` command — worth prioritizing the media re-upload when NIETE brand assets are ready.
- The 2 `registration_*` templates are lower priority — the bot has a `hello_world` fallback path, and the WhatsApp Flow-based registration (already used in the earlier E2E test) doesn't require a template.
- `rumi_portal_reset_otp` is deprioritized — we now use Resend for email-based portal password reset (see `dashboard/services/resend-email.service.js`).
