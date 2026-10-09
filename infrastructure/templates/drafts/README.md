# Drafts — NOT submitted to Meta

These four files are the WhatsApp **utility** templates for the teacher app's "ready" fallback
(`lesson_plan_ready_v1` and `paper_ready_v1`, each in `en` and `ur`). They are **drafts**:

- They live in `drafts/` on purpose. `../publish-templates.sh` submits every `*.json` in the folder ABOVE this
  one, so nothing here can be sent to Meta by running it.
- **Submitting them (and sending any real message) needs the operator's explicit go.** The fallback itself is built
  switched OFF (`app_settings.portal_ready_whatsapp_enabled`, absent = off).
- The header is a **DOCUMENT** (the PDF itself). Meta wants a sample file for it: upload a sample PDF through Meta's
  resumable upload API and paste the returned handle over the `header_handle` placeholder before submitting.
- One **URL button**, `https://portal.niete.edu.pk/t/{{1}}`, the same base the live `lesson_plans_open_v1` /
  `training_open_v1` use; `{{1}}` is a signed portal link token (`bot/shared/services/portal-link-token.js`, area `ready`).
- Templates are per-WABA: sandbox, staging and production each need their own submission and approval, and the
  language code each is approved under must match `TEMPLATE_LANGUAGES` in `portal-web-link.js` (`en`, `ur`).
- Limits are held by `tests/portal/bd-fmf24g.15-ready-templates.test.js` (body 1024, footer 60, URL-button text 25,
  measured in code points; no variable at either end of the body; one example per variable).
