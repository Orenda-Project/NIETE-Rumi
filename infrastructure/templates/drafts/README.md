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

## Turning the fallback on (operator, per environment — nothing here does it)

1. Submit the two templates (four files) on that environment's WABA, with the sample PDF handle; wait for APPROVED.
2. Check the language code each is approved under (`en`, `ur`) and, if the names differ, set `PORTAL_READY_PAPER_TEMPLATE` /
   `PORTAL_READY_LESSON_TEMPLATE` on the bot services.
3. In `app_settings`: `portal_ready_whatsapp_teachers` = `["<users.id>", …]` (a pilot) or `"all"`, THEN `portal_ready_whatsapp_enabled` = `true`.
   It is off while either is absent, and only teachers on `portal_teacher_v2` are ever messaged. It takes effect within ~30 s, no restart.
4. Count first: expected sends = portal papers and 6-12 plans per day × the share neither seen nor opened within ~30 s; each is billed
   by Meta per message (check the current utility rate, and whether a send inside an open 24 h window is free).
5. To stop: set `portal_ready_whatsapp_enabled` to `false`. An item already claimed is never messaged twice, even after a re-enable.

## `teacher_quiz_reminder_v1` (en, ur) — the afternoon quiz offer when the 24-hour window is closed

A teacher who has not written to the bot in a day cannot get the 15:00 quiz offer's reply buttons, so today that
teacher is skipped (`window_closed`). This UTILITY template is the one message that can still reach them: no header, a
fixed body with no variables ("Today's lesson quiz for your class is ready on your NIETE portal. Tap the button to open
it."), the footer "Reply STOP to stop reminders", and one URL button ("Open quiz" / «کوئز کھولیں») on
`https://portal.niete.edu.pk/quiz/teacher/{{1}}` (the quiz teacher home, where the quiz is), where `{{1}}` is a
teacher-home token (`first-touch/teacher-home.token.js`, via `reminder`, 24 hours) in the teacher's language. Drafted
under `en` and `ur`, as every NIETE draft, the codes `bot/shared/services/nudges/window-closed-template.js` sends with.
Measured in code points: body 92 (en) / 86 (ur) of 1024, footer 28 / 36 of 60, button 9 / 11 of 20 — held by
`tests/quiz/lp-quiz-offer-window-template.test.js`. It is used only when `app_settings.lp_quiz_offer_window_template`
names it (absent = off, the skip exactly as before); `LP_QUIZ_OFFER_TEMPLATE_DRY_RUN=1` on the worker logs what would be
sent instead of calling Meta. A teacher who replies STOP (or «روکیں») is recorded in `teacher_reminder_optouts`
(`bot/shared/services/nudges/reminder-stop.js`) and never gets it again, dry run included. At most one billed message per teacher per day (one offer row per teacher per day).
**Not submitted to any WABA**: submitting it, and switching it on, needs the operator's explicit go.
