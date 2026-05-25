---
name: logging
description: How the bot logs — structured single-line JSON to the console, correlation IDs that thread a request across handler/queue/worker, semantic events, and an optional external log backend. Use when adding logging or wiring observability.
---

# Logging Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [debugging](../debugging/SKILL.md), [coaching](../coaching/SKILL.md), [digital-coach](../digital-coach/SKILL.md), [registration](../registration/SKILL.md)

The bot logs **structured single-line JSON to the console** by default — no external service required. A
correlation ID threads one user request across the webhook, the queue, and the workers so you can follow it
end to end. An external log backend is an **optional** add-on, switched on purely by presence of its env
vars.

## The pieces

- [bot/shared/utils/structured-logger.js](../../../bot/shared/utils/structured-logger.js) — the core: overrides `console` to emit single-line JSON, manages correlation context, exports `logEvent` / `runWithCorrelation` / `generateCorrelationId` / `getCurrentCorrelationId`.
- [bot/shared/utils/logger.js](../../../bot/shared/utils/logger.js) — `logToFile(message, data)`: writes a readable file in development *and* logs to the console; auto-enriches `data` with the current correlation ID.

## Correlation IDs

Wrap the handling of an inbound request in `runWithCorrelation` once, and every log line emitted downstream
(handlers, services, workers) carries the same `correlationId` automatically:

```js
const { runWithCorrelation, generateCorrelationId } = require('./shared/utils/structured-logger');

await runWithCorrelation(generateCorrelationId(), async () => {
  await handleMessage(message);   // every logToFile/logEvent inside inherits the id
});
```

For a job that crosses the queue boundary, pass the correlation ID in the job envelope and re-enter
`runWithCorrelation` in the worker so the worker's logs join the same trace.

## Writing logs

```js
const { logToFile } = require('./shared/utils/logger');
logToFile('LP generation started', { userId, topic });      // info + context

const { logEvent } = require('./shared/utils/structured-logger');
logEvent('lesson_plan.generation.started', { userId, requestId });
logEvent('lesson_plan.generation.completed', { requestId, durationMs });
logEvent('lesson_plan.generation.failed', { requestId, error: err.message });
```

**Semantic events** (`feature.stage.started|completed|failed`) are the backbone of tracing: a `.started`
with no matching `.completed`/`.failed` for the same correlation ID points straight at where a request hung.
Always log a `.failed` event with the error in your `catch`.

## Optional external backend

`structured-logger.js` ships an HTTP batcher for an external log store; it self-enables only when its env
vars are present:

```bash
AXIOM_DATASET=...   # set BOTH to ship logs externally; unset → console-only (the default)
AXIOM_TOKEN=...
```

`enabled = !!(AXIOM_DATASET && AXIOM_TOKEN)`. With them unset the batcher is a no-op and you rely on console
+ your platform's log capture — which is sufficient for development and most deploys. Don't make logging
*depend* on the external backend; it must degrade to console cleanly.

## Conventions

- **One line per log** — single-line JSON is greppable and ingest-friendly; avoid multi-line dumps in hot paths.
- **Always attach context** (`userId`, `requestId`, ids) so a line is useful out of order.
- **Never log secrets or PII** — no tokens, no raw phone numbers in message bodies, no full transcripts.
- **`catch` logs a `.failed` event**, not a swallowed `console.error` — a silent `.catch()` is an invisible failure (see [debugging](../debugging/SKILL.md) and the pre-merge JS-ternary class).

## Related Skills

- [debugging](../debugging/SKILL.md) — how to *read* these logs to find one evidence-backed root cause.
- [coaching](../coaching/SKILL.md) · [registration](../registration/SKILL.md) · [digital-coach](../digital-coach/SKILL.md) — features whose flows you'll trace by correlation ID.
