# Drafts — NOT submitted to Meta

The WhatsApp templates here are **drafts**. They live in `drafts/` on purpose: `../publish-templates.sh` submits every
`*.json` in the folder ABOVE this one, so nothing here can be sent to Meta by running it. Submitting any of them (and
sending any real message) needs the operator's explicit go, per WABA: sandbox, staging and production each need their
own submission and approval.

## `coach_report_ready_v1` (en, ur) — the coach's report link when her 24-hour window is closed

Coach reports in the app: a coach's debrief report (and, later, her weekly report) is a page in the coach app. If she
neither opens it nor closes its Home card, ONE WhatsApp message follows with a link straight to it. Inside her 24-hour
window that is a free-form `cta_url` button and needs no template; outside it, this UTILITY template is the only way:
no header, a fixed body with no variables (it names neither the teacher nor the report's contents: messages get
forwarded), the footer "NIETE Digital Coach", and one URL button ("Open my report" / «میری رپورٹ کھولیں») on
`https://portal.niete.edu.pk/t/{{1}}`, where `{{1}}` is a signed portal link token (`portal-link-token.js`, area
`coachreport`, item `debrief:<id>` or `week:<date>`). The body says "coaching report", so one template serves both
reports. Measured in code points and held by `tests/portal/coach-report-template.test.js`. Per WABA: sandbox's button
base is the sandbox portal, not portal.niete.edu.pk; change the URL in the sandbox submission.

It is sent only when `app_settings.coach_report_template_enabled` is `true` (absent = off) AND the coach is on
`app_settings.coach_reports_app`; until then a closed window means no message (the Home card still shows the report).
Submitting it and switching it on need the operator's go, per environment. Template name override: env
`COACH_REPORT_TEMPLATE` on the bot services.
