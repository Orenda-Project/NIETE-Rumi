# templates — HTML/PDF/image templates and Meta WhatsApp template definitions
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/templates kg=d2409c330953 gen=ae1066d60277 overflow=99 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `niete-brand.js` — shared palette and fonts
- `teacher-report.page.js` — teacher web quiz report
- `weekly-usage.template.js` — template definition example
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `transcript-quiz-teacher.template.js` | Three-page teacher PDF for a transcript quiz: lesson taught, questions as the child sees them, how to send |
| `niete-brand.js` | NIETE visual kit shared by rendered artefacts: palette, font stacks, diamond/lattice motifs, Urdu spacing helpers |
| `teacher*` | 6 files; most used `teacher-report.page.js`: Renders the teacher's web quiz report page (/r/token) and its PDF: scores, who has not played, reteach guidance |
| … | 19 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `niete-brand.js` ← imported by `bot/shared/services/quiz/transcript-quiz-card.js:34:636625bf` · `bot/shared/services/quiz/video-quiz-report.service.js:45:51a3e9be` (+8)
- `latin-runs.js` ← imported by `bot/shared/services/coaching/coaching-card/card-template.js:23:4338d9d6` · `bot/shared/services/coaching/report-v2/hero-report.template.js:16:4338d9d6` (+5)
- `teacher-report.page.js` ← imported by `bot/shared/routes/class-round-internal.routes.js:27:4ac1d3ce` · `bot/shared/routes/teacher-jugnu-internal.routes.js:25:4ac1d3ce` (+4)
- … 18 more → `CLAUDE.index.md`

## Never (human)
- observe-visit-notice.template.js is read by both its sender and the registrar script; edit it as one definition (:9-12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/urdu-spacing-kill-switch.test.js` (niete-brand.js, transcript-quiz-teacher.template.js, video-quiz-leaderboard.template.js, video-quiz-report.template.js, video-quiz-scorecard.template.js)
- `bot/tests/quiz/urdu-line-spacing.test.js` (transcript-quiz-teacher.template.js, video-quiz-leaderboard.template.js, video-quiz-report.template.js, video-quiz-scorecard.template.js)
- … 69 more → `CLAUDE.index.md`

## Related (generated)
- skills: `reading-assessment`?
- docs: `bot/shared/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/customization.md`?
