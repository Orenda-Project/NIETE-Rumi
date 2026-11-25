# link — DRAFT, not submitted to Meta (bd-chz35n.25)

`share_dc_report_link_v1` (en + ur): the `share_dc_report_v1` image header and body, plus one line and a URL
button **Open my report** → `https://portal.niete.edu.pk/cr/{{1}}` (the teacher's /cr token, report-link-token.js).

It is the closed-window report for a new-report teacher once `app_settings.report_delivery_fixes.template_link`
names it (report-link-button.js). The switch is off, and the bot must not name this template until Meta has approved it on
that number's WABA.

**Wording waits for Amena's review.** `submit.js` reads only its own folder, so nothing here is submitted. To submit
after review: copy the two files up one level and run `submit.js --only share_dc_report_link_v1` per WABA (sandbox first).
