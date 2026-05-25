# 🧠 Quiz

![Quiz](../images/features/quiz.jpg)

> Turn any topic into a short, interactive quiz the teacher (or their students) can take right in the chat — with instant scoring and a follow-up report.

## What it is

A teacher asks Rumi for a quiz on a topic and answers multiple-choice questions one at a time in WhatsApp.
Rumi generates the questions with the LLM, tracks the session, scores the answers, and follows up with a
short report. It's a fast way to check understanding without leaving the chat.

## How it works

1. **Trigger** — the teacher sends `/quiz <topic>` (or asks for a quiz in conversation). Entry point: [bot/shared/handlers/text-message.handler.js](../../bot/shared/handlers/text-message.handler.js).
2. **Generation** — [bot/shared/services/quiz/quiz-generation.service.js](../../bot/shared/services/quiz/quiz-generation.service.js) produces multiple-choice questions with the LLM; the orchestrator ([quiz-orchestrator.service.js](../../bot/shared/services/quiz/quiz-orchestrator.service.js)) drives generation + delivery.
3. **Delivery** — questions are sent one at a time; the teacher answers by tapping a button or typing `A` / `B` / `C`. The active-quiz reply is intercepted early in the text handler so a bare `A`/`B`/`C` is scored, not treated as chat.
4. **Session state** — [quiz-session.service.js](../../bot/shared/services/quiz/quiz-session.service.js) keeps the question list, answers, and progress in the `quiz_sessions` table.
5. **Report** — when the quiz ends, [quiz-report.service.js](../../bot/shared/services/quiz/quiz-report.service.js) summarises the score and which concepts need work. Long-running pieces run on the worker [bot/workers/quiz-job-handler.js](../../bot/workers/quiz-job-handler.js).

## What the teacher experiences

`/quiz photosynthesis` → a question with options → tap an answer → immediate next question → a friendly
score summary at the end. They can cancel mid-quiz, and a scheduled follow-up can nudge them later.

## Enable it

Core feature — it rides on the required `OPENROUTER_API_KEY` (the LLM that writes the questions). No extra
key needed. Optional Flow-based management can be wired via a quiz Flow id if configured.

## Data

`quizzes`, `quiz_sessions`, `quiz_questions`, and `quiz_answers` (see
[infrastructure/supabase/00_complete-schema.sql](../../infrastructure/supabase/00_complete-schema.sql)).

## Related

- [A/B testing](../../.claude/skills/ab-testing/SKILL.md) — quiz copy/variants can be optimised with the bandit.
- [feature-tracer](../../.claude/skills/feature-tracer/SKILL.md) — trace a quiz session end to end.
