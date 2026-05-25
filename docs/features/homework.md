# 📚 Homework

> Generate a ready-to-assign homework bundle for a class straight from the curriculum — no typing out exercises by hand.

## What it is

A teacher asks Rumi for homework, picks the class/subject/chapters through a short WhatsApp Flow, and Rumi
assembles a homework bundle (a merged PDF of the relevant exercises) and sends it back. The content is drawn
from curriculum-aligned chapter data, so it matches what the class is actually studying.

## How it works

1. **Trigger** — the teacher sends `/homework` (or `/hw`, or an Urdu keyword). Entry point: the homework trigger wired into [bot/shared/handlers/text-message.handler.js](../../bot/shared/handlers/text-message.handler.js) via [bot/shared/handlers/homework-trigger.js](../../bot/shared/handlers/homework-trigger.js).
2. **Collect details** — a WhatsApp Flow (id in `HOMEWORK_FLOW_ID`) collects the class, subject, and chapters taught; the submission is parsed in [bot/shared/handlers/flow-response.handler.js](../../bot/shared/handlers/flow-response.handler.js).
3. **Lookup** — [bot/shared/services/homework-lookup.service.js](../../bot/shared/services/homework-lookup.service.js) finds the matching exercises in the `homework_chapters` table.
4. **Bundle** — the worker [bot/workers/homework-bundle.worker.js](../../bot/workers/homework-bundle.worker.js) merges the selected exercise pages into a single PDF (pulling source pages from object storage) and delivers it.

## What the teacher experiences

`/homework` → a short form (class, subject, chapters) → a "putting it together" message → a tidy homework
PDF they can forward to parents or print.

## Enable it

**Presence-gated on `HOMEWORK_FLOW_ID`** — set the env var to a registered WhatsApp Flow id and the feature
turns on; leave it unset and the teacher is told it isn't available (no crash). It also needs curriculum
homework data loaded in `homework_chapters` for the relevant grades/subjects.

## Data

`homework_chapters` (curriculum exercises), plus `student_lists` for the teacher's classes (see
[infrastructure/supabase/00_complete-schema.sql](../../infrastructure/supabase/00_complete-schema.sql)).

## Related

- [whatsapp-flows](../../.claude/skills/whatsapp-flows/SKILL.md) — how to register and publish the homework Flow.
- [Lesson Plans](lesson-plans.md) · [LP paths](../LP_PATHS.md) — the sibling curriculum-content feature.
