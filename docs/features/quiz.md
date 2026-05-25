# 🧠 Quiz

![Quiz](../images/features/quiz.jpg)

> A teacher turns any topic into a short multiple-choice quiz and **sends it to a whole class** — students answer on their parents' WhatsApp, and the teacher gets a results report.

## What it is

The teacher asks Rumi for a quiz on a topic and picks one of their classes. Rumi generates the questions
with the LLM and delivers the quiz to **every student in that class** via their parent's WhatsApp number.
Each student answers the multiple-choice questions one at a time; Rumi scores them and sends the **teacher**
a class results report. It's a fast way to check a whole class's understanding without printing anything.

## How it works

1. **Trigger** — the teacher sends `/quiz <topic>` (or asks for a quiz in conversation), then picks which **class** receives it from a list. Entry point: [bot/shared/handlers/text-message.handler.js](../../bot/shared/handlers/text-message.handler.js); class selection + the gate (a class with student **parent phone numbers** is required) live in [quiz-orchestrator.service.js](../../bot/shared/services/quiz/quiz-orchestrator.service.js).
2. **Generation** — [quiz-generation.service.js](../../bot/shared/services/quiz/quiz-generation.service.js) produces the multiple-choice questions with the LLM.
3. **Delivery to students** — [quiz-delivery.service.js](../../bot/shared/services/quiz/quiz-delivery.service.js) sends the quiz to **each student's parent phone**, creating a `quiz_session` per student. Students answer by tapping a button or typing `A` / `B` / `C` — that reply is intercepted early in the text handler (before the registration gate) so an unregistered parent/student can play without onboarding.
4. **Session state** — per-student progress (questions, answers) is tracked in `quiz_sessions` against each parent phone.
5. **Report back to the teacher** — once students finish (or a ~12-hour window closes), [quiz-report.service.js](../../bot/shared/services/quiz/quiz-report.service.js) compiles a class results summary and sends it to the teacher. The report/expiry/nudge/reminder jobs run via the queue worker ([quiz-job-handler.js](../../bot/workers/quiz-job-handler.js)).

A teacher can have only one active quiz per class at a time, and can cancel an in-flight quiz (which tears down the per-student state and the pending report).

## What the teacher experiences

`/quiz photosynthesis` → pick a class → "sent to your class" confirmation → students answer on their own
phones over the next while → the teacher receives a results report showing how the class did and which
concepts need reteaching.

## Enable it

Core feature — it rides on the required `OPENROUTER_API_KEY` (the LLM that writes the questions). No extra
key needed. It does require a class set up with student **parent phone numbers** (see the edit-class /
attendance setup), since that's who the quiz is delivered to.

## Data

`quizzes`, `quiz_questions`, `quiz_sessions` (one per student), and `quiz_answers` (see
[infrastructure/supabase/00_complete-schema.sql](../../infrastructure/supabase/00_complete-schema.sql)).

## Related

- [A/B testing](../../.claude/skills/ab-testing/SKILL.md) — quiz copy/variants can be optimised with the bandit.
- [feature-tracer](../../.claude/skills/feature-tracer/SKILL.md) — trace a quiz from send to per-student answers to the teacher's report.
