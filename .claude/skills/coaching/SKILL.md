---
name: coaching
description: Classroom-observation coaching pipeline — pluggable scoring frameworks (OECD/HOTS/TEACH/FICO), the async queue worker, lesson-plan integration, and session debugging.
---

# Coaching Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [debugging](../debugging/SKILL.md), [digital-coach](../digital-coach/SKILL.md)

The coaching feature takes a teacher's classroom-observation audio, transcribes it, scores it against a
pedagogical framework with the LLM, and returns a written + voice report. It runs asynchronously on the
queue worker so a long transcription never blocks the webhook.

## Quick Reference

- **Orchestration**: [bot/shared/services/coaching-orchestrator.service.js](../../../bot/shared/services/coaching-orchestrator.service.js) — the end-to-end pipeline the worker calls.
- **Session lifecycle**: [bot/shared/services/coaching/coaching-session.service.js](../../../bot/shared/services/coaching/coaching-session.service.js) — creates/updates rows in the `coaching_sessions` table.
- **Report**: [bot/shared/services/coaching/report-generator.service.js](../../../bot/shared/services/coaching/report-generator.service.js).
- **Frameworks**: [bot/shared/services/coaching/frameworks/](../../../bot/shared/services/coaching/frameworks/) — `framework-registry.js` plus one module per framework.
- **Worker**: [bot/workers/sqs-worker.js](../../../bot/workers/sqs-worker.js) — pulls coaching jobs off the queue and invokes the orchestrator.
- **LP extraction**: [bot/workers/lesson-plan-extraction.worker.js](../../../bot/workers/lesson-plan-extraction.worker.js).

## Domain Knowledge

### Pluggable scoring frameworks

Scoring is **not** hard-wired to one rubric. The active framework is chosen at runtime through the
registry at [frameworks/framework-registry.js](../../../bot/shared/services/coaching/frameworks/framework-registry.js):

```js
const FRAMEWORKS = {
  oecd:  () => require('./oecd-framework'),
  hots:  () => require('./hots-framework'),
  teach: () => require('./teach-framework'),
  fico:  () => require('./fico-framework'),
};
```

Each module exports its goal/criterion structure, the marks scheme, and the prompt fragments the LLM
uses. The default `oecd` framework scores 5 goals across 19 classroom criteria + 4 reflective-debrief
criteria (23 total). To add a region's own rubric, drop a new `*-framework.js` module and register its key
— no orchestrator changes needed.

Beyond the four registry frameworks, the bot also ships a **MEWAKA** report path (a Tanzania teacher-CPD
format): when a session's framework is `mewaka`, the report is rendered by a dedicated transformer +
template rather than the standard renderer — see the `framework === 'mewaka'` branch in
[bot/shared/services/pdf-report.service.js](../../../bot/shared/services/pdf-report.service.js).

> The framework used for a given session is recorded inside `coaching_sessions.analysis_data.framework`
> (there is no dedicated column). Each framework writes a different `analysis_data` shape, so always read
> the `framework` field first before parsing scores.

### Async pipeline

1. Audio arrives → the orchestrator (or the voice handler) creates a row in `coaching_sessions` and enqueues a job.
2. The job lands on whichever queue driver is configured — see `QUEUE_DRIVER` in [bot/CLAUDE.md](../../../bot/CLAUDE.md) (`sqs` default, or `bullmq` for a Redis-only deploy). Both expose the same surface; the worker code is identical.
3. [bot/workers/sqs-worker.js](../../../bot/workers/sqs-worker.js) dequeues → transcription (STT provider) → framework scoring (LLM via [bot/shared/services/llm-client.js](../../../bot/shared/services/llm-client.js)) → report generation.
4. Results + status are written back to `coaching_sessions`.

### Lesson-plan integration

A teacher can attach a lesson plan before the observation. It is extracted by
[bot/workers/lesson-plan-extraction.worker.js](../../../bot/workers/lesson-plan-extraction.worker.js)
(PDF / DOCX / image), and the text is passed into the scoring prompt so the report can comment on
**fidelity to the plan** — what was planned vs. what the transcript shows was executed. The fidelity block
(`score`, `evidence` pairs, `strengths`, `gaps`) lands under `coaching_sessions.analysis_data`.

## Common Issues & Solutions

| Symptom | Where to look |
|---------|---------------|
| Report generated but no voice note delivered | `coaching_sessions.voice_feedback_url`; confirm the audio uploaded to object storage and the send call succeeded (trace the correlation id — see [debugging](../debugging/SKILL.md)). |
| "Session not found" / generic error to the user | `coaching_sessions.status` and the error/stack columns for the failed step. |
| Session stuck in a non-terminal state (>24h) | [bot/workers/stale-session.worker.js](../../../bot/workers/stale-session.worker.js) sweeps these; check for a job that errored after dequeue. |
| Scores look wrong / empty | Read `analysis_data.framework`, then parse with *that* framework's shape — a mismatch reads as missing scores. |

## Example — coaching stats

```sql
SELECT status, COUNT(*) FROM coaching_sessions GROUP BY status;
```

## Related Skills

- [debugging](../debugging/SKILL.md) — trace a failed or stuck coaching session by correlation id.
- [digital-coach](../digital-coach/SKILL.md) — where coaching sits in the overall bot architecture.
