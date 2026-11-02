# Share templates: "Send on WhatsApp"

The four UTILITY templates the teacher app's **Send on WhatsApp** button sends (`bot/shared/services/share-send.service.js`),
each in `en` and `ur`. She taps Send while she is already in the app, so each one is the file plus one or two short lines:
**no footer, no buttons, no link back.** These are not the ready-fallback drafts in `../drafts/`, which stay unsubmitted.

| Template | Header | Body (en) | Variables |
|---|---|---|---|
| `share_paper_v1` | DOCUMENT (the PDF) | Here is the paper you asked for: *{{1}}* / Grade {{2}} · {{3}} · {{4}} questions | title, grade, subject, question count |
| `share_lesson_plan_v1` | DOCUMENT (the PDF) | Here is your lesson plan: *{{1}}* / Grade {{2}} · {{3}} lesson | title, grade, subject |
| `share_dc_report_v1` | IMAGE (the report) | Your Digital Coach report: *{{1}}* / {{2}} class | topic, class line ("Grade 4 · Science") |
| `share_observation_report_v1` | IMAGE (the report) | Here is your observation report: *{{1}}* / {{2}} class | topic, class line |

The Urdu is in the `_ur.json` files. It uses the app's own words: پرچہ, لیسن پلان, سبق, ڈیجیٹل کوچ, رپورٹ, مشاہدہ رپورٹ, جماعت, سوال, کلاس.

## Meta's rules these were fitted to

- No variable at the start or end of the body. No newline, tab or four spaces inside a value (the service makes every value one line).
- One example per variable.
- **Word ratio** (refused at submission, error subcode `2388293`, "Parameters words ratio exceeds limit"). As measured on
  2026-10-10, the body needs at least **2 × variables + 1** words outside the variables. This is why paper and lesson
  open with "Here is…" and the Urdu paper with یہ رہا آپ کا مانگا ہوا پرچہ.
- Meta classified "Your observation report… / Your {{2}} class" as MARKETING (subcode `2388026`, category mismatch with
  the `ur` already in review). "Here is your observation report" passed as UTILITY.

## Submitting (once per WABA: sandbox, staging, production)

```bash
WHATSAPP_TOKEN=<that WABA's token> WABA_ID=<that WABA> node infrastructure/templates/share/submit.js           # all 8
WHATSAPP_TOKEN=… WABA_ID=… node infrastructure/templates/share/submit.js --only share_paper_v1_en              # one file
WHATSAPP_TOKEN=… WABA_ID=… node infrastructure/templates/share/submit.js --status                              # review state
```

The DOCUMENT and IMAGE headers need a sample file. `submit.js` generates a blank PDF and PNG (no teacher data), uploads
them through Meta's resumable upload under the token's app, and fills in `header_handle`. A REJECTED name is spent, so
fix the copy and submit it as `_v2`.

## Switching it on

The `bot` service reads `WHATSAPP_SHARE_TEMPLATE_{PAPER,LESSON,DC,OBSERVATION}`. Both the send and the availability check
(`GET /api/portal/share/availability`, which the dashboard proxies to the bot) read it there, so set the vars on the `bot`
service only. A kind with no var stays grey ("Not available yet"). Set a var only once its template is APPROVED on
that environment's WABA in both `en` and `ur`.

## The coaching report with the clip button (`share_dc_report_clip_v1`, bd-22gf7p)

Not one of the app's Share templates. Its JSON lives in `clip/`, out of `submit.js`'s reach (it sends only this folder's
top-level files), because the URL button carries one environment's `PORTAL_URL`: the committed pair is **prod**
(`https://portal.niete.edu.pk/v/{{1}}`); sandbox and staging submit the same files with their own `PORTAL_URL` in the
button `url` and its example, nothing else changed. When a coaching report's WhatsApp window is closed and
the session's clip row is `shown`, `report-window-send.js` sends it instead of `share_dc_report_v1`
(`video-reco/clip-button.js`), with exactly these parameters:

| Component | en | ur |
|---|---|---|
| HEADER IMAGE | the stored report (1 param, as `share_dc_report_v1`) | same |
| BODY | `Your Digital Coach report: *{{1}}*` / `{{2}} class` / blank / `A short training clip was picked for this lesson. Tap Watch the clip below.` | `آپ کی ڈیجیٹل کوچ رپورٹ: *{{1}}*` / `{{2}} کی کلاس` / blank / `اس سبق کے لیے ایک مختصر تربیتی کلپ چنا گیا ہے۔ نیچے کلپ دیکھیں دبائیں۔` |
| BUTTONS | one `URL`, index 0, `Watch the clip` (14 code points), `<PORTAL_URL>/v/{{1}}` | `کلپ دیکھیں` (10 code points), same URL |

The body has the same two variables; the clip line is static. The button's `{{1}}` is the `/v` token (`link-token.js`,
surface `wa`). Switch it on with `VIDEO_RECO_CLIP_TEMPLATE=share_dc_report_clip_v1` on every service that sends coaching
reports, once it is APPROVED as UTILITY in both languages on that WABA. Unset = `share_dc_report_v1`, as before.
