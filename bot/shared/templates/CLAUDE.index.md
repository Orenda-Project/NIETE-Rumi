# templates — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/templates -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `class-round.page.js` | Renders the class round's screens (start, teacher, child, hand-back) and its report-tab card for the phone |
| `classroom-observation-report.html` | Handlebars-style HTML template for the classroom observation report PDF (teacher name, scores) |
| `coach-visit-request.template.js` | Meta template definition asking a coach to observe a disagreeing teacher; read by sender and registrar (bd-v0toag.45) |
| `latin-runs.js` | Wraps English phrases in LTR isolates inside RTL Urdu HTML so mixed phrases do not read back to front |
| `niete-brand.js` | NIETE visual kit shared by rendered artefacts: palette, font stacks, diamond/lattice motifs, Urdu spacing helpers |
| `observation-report.template.js` | Generates HTML for the classroom observation report with Rumi branding and score labels |
| `observe-visit-notice.template.js` | Three UTILITY template definitions (booked, moved, cancelled visit) shared by sender and registrar (bd-xorfy) |
| `quiz-report.template.js` | HTML template for the teacher's 12-hour quiz report PDF, rendered by html-to-pdf |
| `reading-report.template.js` | Reading-assessment HTML report for PDF render (Nastaliq/RTL), PDFKit kept as fallback |
| `teacher-class-link-card.js` | Renders the standing class-link card (open, forward, copy, new link with confirm) on the report class tab |
| `teacher-class-week.card.js` | Renders the class week card and forward button on the teacher's Jugnu tab, no JavaScript |
| `teacher-jugnu.page.js` | Renders the teacher's Jugnu tab inside the report chrome, plus forward text and queue copy checks |
| `teacher-report-v21.parts.js` | v21 report pieces (completion tile, tries tag, SLO code chip), shown only with quiz_slo_retest_enabled (bd-v0toag.9/.10) |
| `teacher-report.page.js` | Renders the teacher's web quiz report page (/r/token) and its PDF: scores, who has not played, reteach guidance |
| `teacher-stories.page.js` | Renders the teacher's Stories page: grade/language chips, book preview and Send to class form |
| `transcript-quiz-teacher.template.js` | Three-page teacher PDF for a transcript quiz: lesson taught, questions as the child sees them, how to send |
| `video-quiz-leaderboard.template.js` | Renders the child's CLASS card image: ranked class list with the child's row lit, sent with the teacher report |
| `video-quiz-report.template.js` | Video-quiz class report HTML (NIETE hero, Nastaliq/RTL, i18n): how the class did and what to do next |
| `video-quiz-scorecard.template.js` | Renders the child's end-of-quiz scorecard image with embedded fonts and SVG stars (no system fonts) |
| `web-quiz-art.template.js` | Renders web-quiz share pictures (child card, class, school board, invite) in og 1200x630 and square sizes |
| `weekly-usage.template.js` | Meta UTILITY template definitions for the v10 weekly usage report; skipped if unapproved (bd-v0toag.32) |

## Who reads this (all, generated)
- `class-round.page.js` ← imported by `bot/shared/routes/class-round-internal.routes.js:28:173dbdb7` · `bot/shared/services/quiz/web-quiz-challenge.js:1689:3b23e4a6` · `bot/shared/services/quiz/web-quiz-class-round.js:34:640ef483`
- `coach-visit-request.template.js` ← imported by `bot/scripts/register-coach-visit-request-template.js:20:738c66b8` · `dashboard/services/coach-visit-request.js:17:88b16cc3`
- `latin-runs.js` ← imported by `bot/shared/services/coaching/coaching-card/card-template.js:23:4338d9d6` · `bot/shared/services/coaching/report-v2/hero-report.template.js:16:4338d9d6` · `bot/shared/services/coaching/report-v2/slim-card.template.js:14:4338d9d6` · `bot/shared/services/coaching/video-reco/card-image.js:14:4338d9d6` (+3: `python3 kg/kg.py who-reads latin-runs.js`)
- `niete-brand.js` ← imported by `bot/shared/services/quiz/transcript-quiz-card.js:34:636625bf` · `bot/shared/services/quiz/video-quiz-report.service.js:45:51a3e9be` · `bot/shared/templates/class-round.page.js:21:9f673c89` · `bot/shared/templates/teacher-class-week.card.js:12:4555e454` (+6: `python3 kg/kg.py who-reads niete-brand.js`)
- `observe-visit-notice.template.js` ← imported by `bot/shared/services/observe/observe-teacher-notice.service.js:33:651500a1` · `bot/scripts/register-observe-visit-templates.js:20:45b37a81`
- `quiz-report.template.js` ← imported by `bot/shared/services/quiz/quiz-report.service.js:14:621ac8f6`
- `reading-report.template.js` ← imported by `bot/shared/services/reading/report.service.js:26:961549ae`
- `teacher-class-link-card.js` ← imported by `bot/shared/templates/teacher-report.page.js:674:eea3841a`
- `teacher-class-week.card.js` ← imported by `bot/shared/templates/teacher-jugnu.page.js:23:303e1a10`
- `teacher-jugnu.page.js` ← imported by `bot/shared/routes/teacher-class-week-internal.routes.js:37:584052bd` · `bot/shared/routes/teacher-jugnu-internal.routes.js:24:57acc2ea` · `bot/shared/services/first-touch/teacher-home.strings.js:12:2c21adad`
- `teacher-report-v21.parts.js` ← imported by `bot/shared/templates/teacher-report.page.js:38:afca39ae`
- `teacher-report.page.js` ← imported by `bot/shared/routes/class-round-internal.routes.js:27:4ac1d3ce` · `bot/shared/routes/teacher-jugnu-internal.routes.js:25:4ac1d3ce` · `bot/shared/routes/teacher-report-internal.routes.js:34:11adb375` · `bot/shared/services/quiz/teacher-report-gate.js:24:9f080e6b` (+2: `python3 kg/kg.py who-reads teacher-report.page.js`)
- `teacher-stories.page.js` ← imported by `bot/shared/routes/story-teacher-internal.routes.js:18:7f122ff1`
- `transcript-quiz-teacher.template.js` ← imported by `bot/shared/services/quiz/transcript-quiz-generate.service.js:618:922a235e`
- `video-quiz-leaderboard.template.js` ← imported by `bot/shared/services/quiz/student-quiz.service.js:313:80b46d19` · `bot/shared/services/quiz/video-quiz-report.service.js:1074:4523b264`
- `video-quiz-report.template.js` ← imported by `bot/shared/services/quiz/video-quiz-report.service.js:1184:0e84884f`
- `video-quiz-scorecard.template.js` ← imported by `bot/shared/services/quiz/video-quiz-scorecard.service.js:56:4a1a51ea` · `bot/shared/templates/video-quiz-leaderboard.template.js:58:de6c3e96`
- `web-quiz-art.template.js` ← imported by `bot/shared/services/quiz/web-quiz-art.js:42:98068b07`
- `weekly-usage.template.js` ← imported by `bot/scripts/register-weekly-usage-templates.js:16:cc696cb4` · `bot/shared/services/coaching/weekly-report/message.js:12:8c1c4317`
- env `QUIZ_URDU_SPACING_V2` read at `bot/shared/templates/niete-brand.js:201:e41b88a4`

## Tests (all, generated)
- `class-round.page.js` ← `bot/tests/quiz/web-quiz/class-round-amend.test.js` · `bot/tests/quiz/web-quiz/class-round-challenge.test.js` · `bot/tests/quiz/web-quiz/class-round-endcard.test.js` · `bot/tests/quiz/web-quiz/class-round-lines.test.js` · `bot/tests/quiz/web-quiz/class-round-paused-continue.test.js` · `bot/tests/quiz/web-quiz/class-round-retired-still.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/templates/class-round.page.js`)
- `coach-visit-request.template.js` ← `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` · `tests/coaching/bd-v0toag.45-coach-visit-service.test.js`
- `niete-brand.js` ← `bot/tests/quiz/urdu-spacing-kill-switch.test.js` · `bot/tests/quiz/video-quiz-scorecard-v4.test.js` · `bot/tests/quiz/video-quiz-scorecard.test.js` · `bot/tests/quiz/web-quiz/teacher-class-week.test.js` · `tests/lp612/type-scale.test.js` · `tests/quiz/teacher-artefact-type-floor.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/templates/niete-brand.js`)
- `observe-visit-notice.template.js` ← `bot/tests/observe/bd-xorfy-teacher-visit-notice.test.js`
- `quiz-report.template.js` ← `tests/quiz/quiz-report-template.test.js`
- `reading-report.template.js` ← `tests/reports/reading-report-template.test.js`
- `teacher-class-link-card.js` ← `bot/tests/quiz/web-quiz/web-quiz-class-link.test.js`
- `teacher-jugnu.page.js` ← `bot/tests/quiz/web-quiz/teacher-class-week.test.js` · `bot/tests/quiz/web-quiz/teacher-jugnu-tab.test.js` · `bot/tests/quiz/web-quiz/teacher-jugnu-unbind.test.js`
- `teacher-report-v21.parts.js` ← `bot/tests/quiz/web-quiz/teacher-report-v21-page.test.js`
- `teacher-report.page.js` ← `bot/tests/quiz/web-quiz/class-round.test.js` · `bot/tests/quiz/web-quiz/quiz-report-renders.test.js` · `bot/tests/quiz/web-quiz/story-report-chrome.test.js` · `bot/tests/quiz/web-quiz/story-report-rows.test.js` · `bot/tests/quiz/web-quiz/story-teacher.test.js` · `bot/tests/quiz/web-quiz/teacher-report-page.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/templates/teacher-report.page.js`)
- `teacher-stories.page.js` ← `bot/tests/quiz/web-quiz/story-teacher.test.js`
- `transcript-quiz-teacher.template.js` ← `bot/tests/quiz/latin-runs-rtl.test.js` · `bot/tests/quiz/quiz-column-sum-katex.test.js` · `bot/tests/quiz/quiz-equation-runs-katex.test.js` · `bot/tests/quiz/quiz-stacked-fractions-katex.test.js` · `bot/tests/quiz/quiz-typeset-maths-katex.test.js` · `bot/tests/quiz/teacher-pdf-summary-quoted-title.test.js` (+14: `python3 kg/kg.py who-reads bot/shared/templates/transcript-quiz-teacher.template.js`)
- `video-quiz-leaderboard.template.js` ← `bot/tests/quiz/urdu-line-spacing.test.js` · `bot/tests/quiz/urdu-spacing-kill-switch.test.js` · `bot/tests/quiz/video-quiz-leaderboard.test.js` · `tests/quiz/child-card-subject-and-topic.test.js` · `tests/quiz/child-copy-urdu-grammar.test.js`
- `video-quiz-report.template.js` ← `bot/tests/quiz/class-report-layout.test.js` · `bot/tests/quiz/latin-runs-rtl.test.js` · `bot/tests/quiz/urdu-line-spacing.test.js` · `bot/tests/quiz/urdu-spacing-kill-switch.test.js` · `bot/tests/quiz/video-quiz-report-guidance-clean.test.js` · `bot/tests/quiz/video-quiz-report-template.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/templates/video-quiz-report.template.js`)
- `video-quiz-scorecard.template.js` ← `bot/tests/quiz/urdu-line-spacing.test.js` · `bot/tests/quiz/urdu-spacing-kill-switch.test.js` · `bot/tests/quiz/video-quiz-scorecard-v4.test.js` · `bot/tests/quiz/video-quiz-scorecard.test.js` · `tests/quiz/child-card-subject-and-topic.test.js`
- `web-quiz-art.template.js` ← `bot/tests/quiz/web-quiz/web-quiz-art-copy-one.test.js` · `bot/tests/quiz/web-quiz/web-quiz-art-invite-copy.test.js` · `bot/tests/quiz/web-quiz/web-quiz-art-name-fit.test.js` · `bot/tests/quiz/web-quiz/web-quiz-art-pic-polish.test.js` · `bot/tests/quiz/web-quiz/web-quiz-art-ur-digits.test.js` · `bot/tests/quiz/web-quiz/web-quiz-art-ur-polish.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/templates/web-quiz-art.template.js`)
- `weekly-usage.template.js` ← `bot/tests/coaching/weekly-report/weekly-usage-template.test.js`

## Related (all, generated)
- skills: `reading-assessment`?
- docs: `bot/shared/CLAUDE.md`? · `bot/shared/templates/CLAUDE.index.md`? · `bot/shared/templates/CLAUDE.md`? · `bot/tests/coaching/weekly-report/CLAUDE.index.md`? · `bot/tests/coaching/weekly-report/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/customization.md`?
