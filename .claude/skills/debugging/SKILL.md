---
name: debugging
description: Investigation discipline and correlation-id tracing for the bot — how to find ONE evidence-backed root cause instead of guessing, and the log queries that get you there.
---

# Debugging Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [coaching](../coaching/SKILL.md), [digital-coach](../digital-coach/SKILL.md), [registration](../registration/SKILL.md)

This bot emits structured logs tagged with a **correlation id** that threads a single user request across
the webhook, the queue, and the workers. Debugging is the practice of following that thread to **one
root cause backed by evidence** — a row count, a commit hash, a log line — never a guess.

## Investigation Non-Negotiables

Every investigation must:

1. **Query real data, don't assume.** Pull the actual DB row for the affected user (by `id` — the UUID — not by phone) before theorising.
2. **Trace by correlation id.** Follow the full request flow through the logs, start to finish.
3. **Verify with proof.** "LP not created" is a hypothesis until a `SELECT` confirms zero rows.
4. **Count real usage.** How many LPs / coaching sessions / videos does this user actually have?

## Investigation discipline rules

These exist because each one, skipped, has produced a wrong conclusion. Apply them on every investigation.

### Rule A — One root cause, not "either X or Y"

If your report says *"either X or Y"* about the root cause, you are not done. Competing hypotheses are
**research notes**, not a conclusion. When you catch yourself writing two causes, **stop**, find the
smallest query that distinguishes them, run it, and only then write the report. Exactly one hypothesis
survives the query — that is the root cause. If you genuinely cannot disambiguate (no access, no
telemetry), say *that* and name the query that would resolve it. Don't dress up uncertainty as a finding.

### Rule B — Find the source, don't add a guard

For LLM-behaviour bugs (verbal tics, format leakage, register slips), the first move is to find **what
prompted** the behaviour: read the actual rendered system prompt for the failing turn (not the template),
the context that was loaded, and the prior turn (the model mirrors what it just saw). The fix is almost
always to **remove the source** — strip the phrasing the model is echoing, delete the few-shot example
that anchored the tic. Adding a "don't do X" rule on top is the worst fix: it concedes the cause exists,
the model still violates it a few percent of the time, and the prompt grows two instructions that fight
each other.

### Rule C — Check adjacent changes before saying "regression"

When a feature breaks, before blaming the most recent change *to that feature*, check recent commits
touching **shared** code paths (anything under `bot/shared/services/`). A change to a neighbouring
feature regularly breaks a shared service. `git log --since='N hours ago' --oneline` the affected files.
If you find no adjacent commit, say *"no adjacent commit found"* — that is itself a finding.

### Rule D — A projected query manufactures false negatives; pull RAW rows before asserting "no X"

Before concluding "the bot didn't reply" / "the event never fired", pull the **full raw log rows** for the
correlation id — every field — not a projected subset. A projection that drops the send/delivery fields
*looks* like silence even when the send succeeded. Trace with no projection first; project only once
you've seen the whole shape.

### Rule E — "generated/stored" ≠ "delivered"; verify the delivery event, scoped to that user

A `*_requests.status = 'completed'` means generation finished, **not** that the user received anything.
For "did the user actually get X", verify the **delivery/send** event AND scope the filter strictly to
that user's id **and** phone. A loose filter returns *other* users' delivery events that look like a false
positive.

### Rule F — For "what the user saw", the screenshot is ground truth; reconcile its clock

When a user reports "no response / wrong reply", align their phone's clock to the log timestamps **before**
naming a cause. A screenshot taken in the async gap (instant ack, substantive reply lands seconds/minutes
later) looks identical to a failure but is a latency-perception issue, not a drop.

### Rule G — Don't publish a root cause to an external artifact until it's evidence-complete

A root cause or a scale claim ("N users affected") read by non-engineers drives triage and is often hard
to retract. Don't publish one until Rules A, D, and E are satisfied. Investigate to evidence-complete,
*then* publish.

### Rule H — Before proposing "route to existing flow X", verify X exists AND that the path reaches it

When a fix says "send them to the existing flow", (a) confirm that flow/UI actually exists in the code
(don't invent one), and (b) trace the *specific* entry path — two entry points for the "same" feature
often diverge. Enumerate **every** gating predicate for a cohort feature and verify the data feeding it is
actually populated (a column the code reads may not exist).

## Logging & tracing

The bot logs structured JSON through [bot/shared/utils/structured-logger.js](../../../bot/shared/utils/structured-logger.js),
which wraps each request in `runWithCorrelation(correlationId, ...)` so every downstream line carries the
same id (the simpler [bot/shared/utils/logger.js](../../../bot/shared/utils/logger.js) is the underlying writer). Out of the box this writes to the console (and to a file in development) — see the logging notes
in [bot/CLAUDE.md](../../../bot/CLAUDE.md) for wiring an optional external log backend.

**The core workflow:**

1. **Get the correlation id** from the error or the user's request.
2. **Trace the full flow** — every line for that id, time-ordered, *unprojected* (Rule D).
3. **Find the failure point** — where does the trace stop? Look for the `*.failed` event and its error/stack.
4. **Check semantic events** — `*.started` / `*.completed` / `*.failed` pairs reveal which stage hung.

```text
# pattern: filter logs to one request, oldest-first
correlationId == "corr-xxx"  → order by time asc
```

### Duplicate processing

When debugging duplicate deliveries, look for the same `requestId` processed more than once. Workers are
idempotent — they check status before processing:

```js
if (existingRequest?.status === 'completed') return;        // already done
if (existingRequest?.status === 'processing' && ageMs < 120000) return; // another worker has it
```

Multiple "starting generation" lines for one `requestId`, or multiple PDFs to one user, point at an
idempotency gap.

## Common Issues & Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| No logs appearing | Logger not initialised / env vars missing | Confirm the log backend env vars on the running service. |
| Code change not reflected | Deploy still building | Wait for the deploy to finish; confirm the new process actually started. |
| Can't find a correlation id | Log entry predates the request, or id wasn't propagated | Filter by user id + time range instead. |
| Silent failure, no error log | Missing defensive logging at the boundary | Add checkpoint logs before/after the suspect call, redeploy, reproduce. |

## Related Skills

- [coaching](../coaching/SKILL.md) — debugging a failed or stuck coaching session.
- [digital-coach](../digital-coach/SKILL.md) — the architecture map that tells you which worker to trace.
- [registration](../registration/SKILL.md) — debugging the registration state machine.
