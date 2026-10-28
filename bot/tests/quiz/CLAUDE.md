# quiz — Jest suites for the quiz stack: video/chat quiz, reports, student door, web quiz
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz kg=df241f871a78 gen=98db86ffe72d overflow=80 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `quiz-sources.test.js` — smallest map of quiz_source kinds (transcript, lp_v8, lp612) the rest assume
- `web-quiz/` — Jugnu web quiz, Challenge, class round, teacher report; most files live here
- `report-send-checked.test.js` — pattern for flag-gated report delivery with an OFF golden
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 test files) |
| `goldens/` | Recorded OFF-switch call-log goldens for the quiz report send-checked tests → `goldens/CLAUDE.md` |
| `helpers/` | Render-and-measure helpers that read PDFs and pages back as ink for layout tests → `helpers/CLAUDE.md` |
| `teacher-quiz-menu/` | Tests for the teacher /quiz home, report list and button routing → `teacher-quiz-menu/CLAUDE.md` |
| `web-quiz/` | Jest suite for the kid-facing web quiz, hub, Challenge, stories and share flows → `web-quiz/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `transcript*` | 4 files; most used `transcript-quiz-flow-endpoint.test.js`: R6 lane M: /quiz as one WhatsApp Flow; paging stays in-Flow, lesson tap shows results, actions end on DONE |
| `one-voice-missing-keys.test.js` | Pins read-only pre-flip check one-voice-missing-keys.js for web_quiz_one_voice: lists missing clips by id |
| … | 80 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `CHILD_TEST_R2_ENV` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `PHONE_NUMBER_ID` · `QUIZ_LP612_SOURCE` · `QUIZ_MULTI_FLOW_ID` · `QUIZ_URDU_SPACING_V2` · `RECORD_OFF_GOLDEN` · `STUDENT_JOIN_FLOW_ID` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL` · `TEACHER_NUDGES_ENABLED` (+3)

## Never (human)
- Keep real-KaTeX maths suites under bot/: the root jest config stubs katex (quiz-typeset-maths-katex.test.js:5)
- No phone-shaped digit literals in fixtures; build them at runtime (web-quiz/fixture-phone.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.index.md`? · `bot/scripts/quiz/CLAUDE.index.md`? · `bot/scripts/quiz/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/database/CLAUDE.index.md`? · `bot/shared/database/CLAUDE.md`? (+25)
