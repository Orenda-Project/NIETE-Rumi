---
name: feature-tracer
description: Trace any feature end to end — webhook → handler → service → queue → worker → DB → storage → delivery — to find where a user's request actually broke. The map that points you at the right service, worker, table, and skill for each feature.
---

# Feature Tracer Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [debugging](../debugging/SKILL.md), [digital-coach](../digital-coach/SKILL.md), [logging](../logging/SKILL.md), [coaching](../coaching/SKILL.md), [reading-assessment](../reading-assessment/SKILL.md), [registration](../registration/SKILL.md), [video-generation](../video-generation/SKILL.md)

This is the **"where do I look?"** hub. A tracer is a disciplined walk of one request through the system to
find where it broke. The investigation rules and correlation-id mechanics live in [debugging](../debugging/SKILL.md)
and [logging](../logging/SKILL.md); this skill maps each feature to the exact code path and storage so you
know *which* service/worker/table to trace.

## The trace path (every feature)

```
WhatsApp webhook → bot/whatsapp-bot.js
  → bot/shared/handlers/<type>.handler.js     (routed by message type / button / flow)
    → bot/shared/services/<feature>/…         (business logic; LLM, STT, TTS)
      → enqueue a job (the QUEUE_DRIVER queue)
        → bot/workers/<feature>.worker.js      (long work: transcribe / generate / score)
          → Postgres rows + object storage (bot/shared/storage/r2.js)
            → delivery (bot/shared/services/whatsapp.service.js)
```

At each hop, the questions are: did the request reach this layer (a log line for the correlation id), did it
leave (a `.completed` event or the next layer's `.started`), and did it persist what it should (query the
table)? The hop where the trace goes quiet is the failure point.

## Non-negotiables

1. **Query real data** — pull the actual row by `users.id` (UUID), don't assume.
2. **Trace by correlation id** — follow the full flow, unprojected first (see [debugging](../debugging/SKILL.md) Rule D).
3. **"generated" ≠ "delivered"** — a `*_requests.status='completed'` is not proof the user received anything; verify the send event.
4. **Count real usage** — how many of this artifact does the user actually have?

## Feature map

| Feature | Entry handler | Core service | Worker | Tables | Deep-dive skill |
|---------|---------------|--------------|--------|--------|-----------------|
| Coaching | voice / text handler | `coaching-orchestrator.service.js` | `sqs-worker.js` → `coaching-processor.js` | `coaching_sessions` | [coaching](../coaching/SKILL.md) |
| Reading assessment | `text-message.handler.js` (`/reading`) | `reading-assessment.service.js` + `reading/*` | (inline / queue) | `reading_assessments` | [reading-assessment](../reading-assessment/SKILL.md) |
| Lesson plans | `lesson-plan-v2.handler.js`, `image-message.handler.js` | `lesson-planning` / router services | `lesson-plan-generation.worker.js`, `lesson-plan-extraction.worker.js`, `pic-lp-kieai.worker.js` | `lesson_plans`, `lesson_plan_requests` | — (see [debugging](../debugging/SKILL.md)) |
| Registration | `text-message.handler.js`, `flow-response.handler.js` | `feature-registration.service.js` | — | `users` | [registration](../registration/SKILL.md) |
| Video | (video orchestrator) | `video/video-orchestrator.service.js` | `video-generation.worker.js` | `video_requests`, `video_tasks` | [video-generation](../video-generation/SKILL.md) |
| Quiz (teacher → class; students answer) | `text-message.handler.js` (`/quiz`) | `quiz/*` services | `quiz-job-handler.js` | `quizzes`, `quiz_questions`, `quiz_sessions`, `quiz_answers` | — |
| Exam checker | `exam-checker.handler.js` | exam services | `exam-grading.worker.js` | `exam_grades` | — |
| Homework | `homework-trigger.js` | `homework-lookup` service | `homework-bundle.worker.js` | `homework_chapters` | — |
| Text chat | `text-message.handler.js` | chat / context services | — | `conversations` | — |

(Exact file list: [bot/CLAUDE.md](../../../bot/CLAUDE.md). Schema: [infrastructure/supabase/00_complete-schema.sql](../../../infrastructure/supabase/00_complete-schema.sql).)

## Common queries

```sql
-- Find the user (by UUID downstream; phone only to look them up)
SELECT id, phone_number, first_name, preferred_language, registration_completed, created_at
FROM users WHERE phone_number = '<normalised phone>';

-- Recent activity for a user (swap the table per the feature map)
SELECT id, status, created_at FROM coaching_sessions
WHERE user_id = '<uuid>' ORDER BY created_at DESC LIMIT 20;
```

For artifacts in object storage (audio, PDFs, video), the row holds the key/URL — confirm the file exists
and was delivered, don't infer it from `status`. Ready-to-run analytics SQL:
[database-analysis](../database-analysis/SKILL.md).

## Related Skills

- [debugging](../debugging/SKILL.md) — the investigation discipline + correlation-id mechanics.
- [logging](../logging/SKILL.md) — what the logs contain and how the correlation id is propagated.
- [coaching](../coaching/SKILL.md) · [reading-assessment](../reading-assessment/SKILL.md) · [registration](../registration/SKILL.md) · [video-generation](../video-generation/SKILL.md) — per-feature depth.
