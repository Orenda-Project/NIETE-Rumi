---
name: digital-coach
description: Architecture map for the WhatsApp teaching-assistant bot — what it does, how the pieces fit, and where to drill in. The orientation hub for development, debugging, and extension.
---

# Digital Coach — Bot Knowledge Base

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [debugging](../debugging/SKILL.md)

This is the **orientation hub**. Read it first to understand how the bot is shaped, then drill into a
folder router or a feature skill. Don't load everything at once — be strategic about context.

## What it is

An AI WhatsApp assistant for teachers. Core capabilities:

- **Conversational teaching advice** via an LLM.
- **Voice-message transcription** (speech-to-text) so teachers can talk, not type.
- **Lesson-plan generation** and **classroom-observation [coaching](../coaching/SKILL.md)**.
- **Text-to-speech** replies for low-literacy / low-bandwidth contexts.

It is region-agnostic: language, curriculum, and which features are switched on are all driven by
configuration, never hard-coded. See the **presence-based gating** model below.

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js + Express |
| Messaging | WhatsApp Cloud API (webhook in, Graph API out) |
| LLM | Pluggable through [bot/shared/services/llm-client.js](../../../bot/shared/services/llm-client.js) (e.g. an OpenRouter gateway) |
| Datastore | Postgres (via Supabase) |
| Async work | Pluggable queue — `QUEUE_DRIVER=sqs` (default) or `bullmq` (Redis-only). See [bot/CLAUDE.md](../../../bot/CLAUDE.md). |
| STT / TTS | External providers, configured by env |

## How the code is laid out

Start from the routers — they are kept accurate to the shipped code:

- **[CLAUDE.md](../../../CLAUDE.md)** (repo root, L0) — overview, swim pattern, presence-gating, `QUEUE_DRIVER`, the repo map.
- **[bot/CLAUDE.md](../../../bot/CLAUDE.md)** (L1) — the bot codebase: entry point, handlers, services, workers, the queue abstraction.
- **[infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md)** (L1) — schema, RLS, seed data, the DB bootstrap script.

The request path, end to end:

```
WhatsApp webhook → bot/whatsapp-bot.js (entry)
   → bot/shared/handlers/*.handler.js   (route by message type)
      → bot/shared/services/*           (business logic; LLM, STT, TTS, persistence)
         → enqueue long jobs onto the queue
            → bot/workers/*.js          (transcribe, generate, score, deliver)
```

## Presence-based feature gating

There is **no tier system**. A feature turns on when the env vars it needs are present — checked through
[bot/shared/config/feature-availability.js](../../../bot/shared/config/feature-availability.js). Set the
coaching keys and coaching works; leave them unset and the bot degrades gracefully. Per-region toggles can
additionally be stored in the `region_features` table (fail-open). This is what makes the same codebase
deployable by anyone with their own credentials — see [.env.template](../../../.env.template).

## Where to go next

| You want to… | Go to |
|--------------|-------|
| Set up locally | [.env.template](../../../.env.template) + [infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md) (bootstrap the DB) |
| Understand the bot code | [bot/CLAUDE.md](../../../bot/CLAUDE.md) |
| Debug a failing request | [debugging](../debugging/SKILL.md) |
| Work on coaching | [coaching](../coaching/SKILL.md) |
| Work on registration | [registration](../registration/SKILL.md) |

## Working style

When documenting or communicating about the bot: technical accuracy over marketing; problem → solution →
trade-offs (be transparent about limitations); show code, don't just describe it; note when a fact was
last verified, since pricing and provider behaviour drift. When in doubt, check the git history and the
running service's logs for the latest state.

## Related Skills

- [debugging](../debugging/SKILL.md) — investigation discipline and correlation-id tracing.
