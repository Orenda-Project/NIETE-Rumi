# WhatsApp Message Templates — NIETE Fork

**Status**: 🟡 Templates harvested from PK production; publishing to NIETE WABA pending Meta setup.

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
