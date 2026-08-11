# 🎬 Video Library + Video Quizzes

> A teacher browses a library of short student videos, sends one to their class, and the child can take a
> linked quiz right after watching — scored, forwardable to classmates via a wa.me link, with results back
> to the teacher the next morning.

## What it is

Ported from the main Rumi bot (bd-2482, 2026-08-04) after it stabilized in PK production. Distinct from
[Quiz](quiz.md) (the LLM-generated, teacher-triggered class quiz) — this is **library content**: a fixed bank
of videos and their attached quizzes, browsable by grade/subject/topic, that any teacher or child can reach
without a teacher having to generate anything.

## How it works

1. **Browse** — `STUDENT_VIDEOS_FLOW_ID` (grade → subject → topic) delivers the chosen video from R2. Entry
   points: `/video` command, or the `select_video` broadcast-template button.
   [student-videos-endpoint.js](../../bot/shared/routes/student-videos-endpoint.js)
2. **Quiz offer** — after delivery, [video-quiz.service.js](../../bot/shared/services/quiz/video-quiz.service.js)
   offers the video's linked quiz (if one exists). A teacher can also attempt it herself (`source: video_solo`).
3. **Taking it** — questions send via buttons/list/`VIDEO_QUIZ_FLOW_ID` (picture-answer, falls back to a
   numbered list if the Flow is unavailable). Answers route through the `vq_` id prefix in `whatsapp-bot.js`.
4. **Scorecard** — [video-quiz-scorecard.service.js](../../bot/shared/services/quiz/video-quiz-scorecard.service.js)
   renders an image (score-tier background, stars, the taker's name) via Playwright.
5. **Forward to class** — [video-quiz-share.service.js](../../bot/shared/services/quiz/video-quiz-share.service.js)
   mints a `quiz_share_codes` row + wa.me link. A child arriving via that link registers name+class through
   `STUDENT_JOIN_FLOW_ID`, and can invite a friend in turn.
6. **Class report** — [video-quiz-report.service.js](../../bot/shared/services/quiz/video-quiz-report.service.js)
   sends the teacher a PDF the next morning, once per share code (queued via `quiz_video_report` jobs in
   [sqs-worker.js](../../bot/workers/sqs-worker.js)).

## Data

`student_videos`, `quizzes` (`video_id` set), `quiz_questions`, `quiz_answers`, `quiz_sessions` (`source` =
`video_solo`/`share_link`), `quiz_share_codes`, `video_quiz_deliveries`, `student_video_feedback`. Schema
ported in `bot/database/migrations/create_video_quiz_tables.sql`, written against PK's **live** schema (not
its migration files, which have documented drift) and verified against NIETE's live schema before/after apply.

**Content**: 969 videos / 943 linked quizzes / 11,831 questions copied from PK — pure library content (every
video-linked quiz on PK has `teacher_id`/`lesson_plan_id`/`list_id` NULL, so zero PK teacher/child data
crossed over). R2 files were **not** re-uploaded — PK and NIETE share the same Cloudflare R2 account+bucket,
so `r2_url` was copied verbatim.

## Enable it

`VIDEO_QUIZ_FLOW_ID`, `STUDENT_JOIN_FLOW_ID`, `STUDENT_VIDEOS_FLOW_ID` (all registered PUBLISHED on NIETE's
WABA as part of this port — `STUDENT_VIDEOS_FLOW_ID` had never been set before, so video browsing was
unreachable dead code prior to 2026-08-04), `WHATSAPP_BOT_NUMBER` (so forwarded wa.me links open NIETE's own
number, not another deployment's).

## Post-port fixes (2026-08-04, same day — operator phone-testing)

Operator tested the ported feature live (Sabeena's share_link session) and found 3 real issues, all
root-caused against live production data before writing fix code, and all ported from PK's own same-day
fixes for feature parity:

1. **Watch-more-videos offer never appeared** — root cause was NOT a code bug: PK's own binge-loop feature
   (bd-2475, "after a declined friend-invite, offer another round") had been sitting on PK's staging for
   weeks, never promoted to PK's main, so NIETE's port (sourced from PK main) simply never had it. Ported
   here once PK shipped it to its own prod. New: `child-flow-token.js`, `video-quiz-binge.service.js`.
2. **`option_feedback` named the wrong letter after a shuffle** — the render-time shuffle repositions
   options for display without touching the pre-authored `option_feedback` text, which references letters
   in STORED order. Fixed by remapping (not stripping) every letter token to the shown letter in
   `feedbackFor()` (`video-quiz-render.service.js`).
3. **Bare "video" (no slash) opened the wrong feature** — fell through to intent detection and the legacy AI
   video generator instead of the library. Fixed same-day, twice: once NIETE-only inline, then refactored to
   match PK's cleaner extracted `isVideoCommand()` for consistency between the two codebases.

## Related

- [Quiz](quiz.md) — the sibling LLM-generated class-quiz feature; shares the underlying `quizzes` tables but
  no code path.
- [feature-tracer](../../.claude/skills/feature-tracer/SKILL.md) — trace a video-quiz attempt end to end.
