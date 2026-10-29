# quiz — Jest suites for the quiz stack: video/chat quiz, reports, student door, web quiz
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz kg=5438465c3b6c gen=715a7fbce1cb overflow=77 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `quiz-sources.test.js` — smallest map of quiz_source kinds (transcript, lp_v8, lp612) the rest assume
- `web-quiz/` — Jugnu web quiz, Challenge, class round, teacher report; most files live here
- `report-send-checked.test.js` — pattern for flag-gated report delivery with an OFF golden
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 files: 0 test + 3 support) |
| `goldens/` | → (no door; 2 files: 0 test + 2 support) |
| `helpers/` | Render-and-measure helpers that read PDFs and pages back as ink for layout tests → `helpers/CLAUDE.md` |
| `teacher-quiz-menu/` | Tests for the teacher /quiz home, report list and button routing → `teacher-quiz-menu/CLAUDE.md` |
| `web-quiz/` | Jest suite for the kid-facing web quiz, hub, Challenge, stories and share flows → `web-quiz/CLAUDE.md` |
| `transcript*` | 4 files; most used `transcript-quiz-flow-endpoint.test.js`: R6 lane M: /quiz as one WhatsApp Flow; paging stays in-Flow, lesson tap shows results, actions end on DONE |
| `one-voice-missing-keys.test.js` | Pins read-only pre-flip check one-voice-missing-keys.js for web_quiz_one_voice: lists missing clips by id |
| `report*` | 5 files; most used `report-delivery-send.test.js`: Pins that an accepted class report keeps its wamid in Redis report_msg:<id> for 48h when quiz_report_send_checked is on |
| `chat-quiz-report-send-checked.test.js` | Pins quiz_report_send_checked in quiz-job-handler handleQuizReport: flag set only if WhatsApp took it, 3 tries |
| … | 104 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Keep real-KaTeX maths suites under bot/: the root jest config stubs katex (quiz-typeset-maths-katex.test.js:5)
- No phone-shaped digit literals in fixtures; build them at runtime (web-quiz/fixture-phone.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/quiz/CLAUDE.md`? · `bot/shared/services/tts/CLAUDE.md`? · `bot/shared/templates/CLAUDE.md`? · `bot/shared/utils/CLAUDE.md`? · `bot/tests/CLAUDE.md`?
