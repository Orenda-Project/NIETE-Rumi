# quiz-page — the closed-window report whose button opens the quiz page

The closed-window coaching report for a teacher who does not get the new report (v10 arms A/B, schools outside the
draw): the `share_dc_report_v1` image header and body, one line, and a URL button → `https://portal.niete.edu.pk/cq/{{1}}`
(the teacher's /cr token, report-link-token.js). The page has only the lesson's quiz on it: the teacher makes the quiz
there, reads the questions, and copies or shares the class message from it (dashboard/services/report-quiz-page.js).

It goes once `app_settings.quiz_offer_closed_window` carries `"report_page": true` and `"quiz_page_template": "<name>"`
(bot/shared/services/quiz/report-page-quiz.js). The bot names a template only once Meta has approved it as UTILITY,
in both languages, on that number's WABA. A name filed MARKETING is never named: without `quiz_page_template` those
teachers keep today's report.

| Name | Button | Meta's filing |
|---|---|---|
| `share_dc_report_open_v1` | Make a quiz | MARKETING (26 Nov 2026): unused |
| `share_dc_report_open_v2` | See next step / اگلا قدم دیکھیں | submitted UTILITY 26 Nov 2026; read the category on each WABA before naming it |

`submit.js` reads only its own folder, so nothing here is submitted. To submit: copy the two files up one level and run
`submit.js --only <name>` per WABA (sandbox first). Never delete and recreate a name; a change is the next version.
