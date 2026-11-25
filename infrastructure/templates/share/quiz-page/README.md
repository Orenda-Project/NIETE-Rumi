# quiz-page — DRAFT, not submitted to Meta

`share_dc_report_open_v1` (en + ur), UTILITY: the `share_dc_report_v1` image header and body, one line, and a URL
button **Make a quiz** → `https://portal.niete.edu.pk/cq/{{1}}` (the teacher's /cr token, report-link-token.js), a page
with only the lesson's quiz on it (dashboard/services/report-quiz-page.js).

It is the closed-window coaching report for a teacher who does not get the new report (v10 arms A/B, schools outside
the draw) once `app_settings.quiz_offer_closed_window` carries `"report_page": true` and
`"quiz_page_template": "share_dc_report_open_v1"` (bot/shared/services/quiz/report-page-quiz.js). The switch is off, and the
bot must not name this template until Meta has approved it as UTILITY on that number's WABA. If Meta files it as
MARKETING, do not use it: remove `quiz_page_template` and those teachers keep today's report.

`submit.js` reads only its own folder, so nothing here is submitted. To submit: copy the two files up one level and run
`submit.js --only share_dc_report_open_v1` per WABA (sandbox first). Never delete and recreate the name; a change is v2.
