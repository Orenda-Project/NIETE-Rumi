---
name: cross-agent-safety
description: Safety checks before modifying shared bot services. Verify imports, check downstream consumers, run the suite. Use when editing anything in bot/shared/services/ or bot/workers/ — files many features depend on.
paths: bot/shared/services/**,bot/workers/**
user-invocable: false
---

# Cross-Agent Safety Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [coaching](../coaching/SKILL.md), [pre-merge-checklist](../pre-merge-checklist/SKILL.md)

A checklist for editing **shared** code — services and workers that many features import. A careless change
to one of these crashes features far from the file you touched. Run these before you push.

## MANDATORY steps before modifying anything in `bot/shared/services/`

### 1. Verify ALL imports

If you add a function call (e.g. `logEvent()`), confirm its import exists at the top of the file:

```bash
grep -n "logEvent" path/to/file.js   # must appear as an import, not just a usage
```

### 2. Check downstream consumers BEFORE renaming or removing

```bash
grep -rn "methodName" bot/shared/ bot/workers/ --include="*.js"
```

Count the call sites; update **all** of them, not just the definition.

### 3. Run the test suite BEFORE and AFTER

```bash
npm test
```

This catches `ReferenceError` / `TypeError` from a missing import. Run it before every push.

### 4. Verify column names before using them in queries

The `users` table uses `phone_number` (not `phone`) and `first_name` (not `name`). Always confirm a column
exists before referencing it in `.select()` / `.update()`.

### 5. Don't chain `.update().eq().in().select().single()`

A chained Supabase update with multiple WHERE conditions + `.select().single()` can return
`{ data: null, error: null }` even when the WHERE matches a row — silently swallowing constraint violations.
Split it (fetch → JS-check → plain update → check `error`). Full pattern + the failure modes it hides:
[pre-merge-checklist/reference/db-mutation-safety.md](../pre-merge-checklist/reference/db-mutation-safety.md).

**Apply when**: any UPDATE with two or more WHERE conditions beyond `eq('id', ...)`, or where the new value
is enum-like (status, kind, type).

## High-blast-radius files

| File | Used by | Risk |
|------|---------|------|
| [bot/shared/services/llm-client.js](../../../bot/shared/services/llm-client.js) / [openai.service.js](../../../bot/shared/services/openai.service.js) | Coaching, lesson plans, quiz, chat | ANY change can break ALL LLM features |
| [bot/shared/services/whatsapp.service.js](../../../bot/shared/services/whatsapp.service.js) | Every outbound message | ANY change can silence the bot |
| [bot/shared/services/cache/railway-redis.service.js](../../../bot/shared/services/cache/railway-redis.service.js) | State, rate limiting | Changes break session flows |
| [bot/shared/storage/r2.js](../../../bot/shared/storage/r2.js) | Coaching, reading, video media | Storage changes break media delivery |

## Never bundle critical-path and best-effort DB writes

If one column in an atomic update doesn't exist (or violates a constraint), the **entire** update fails —
taking the critical write down with the best-effort one.

```js
// BAD — if best_effort_col doesn't exist, the whole update fails
await supabase.from('t').update({ sent_at: new Date(), best_effort_col: x }).eq('id', id);

// GOOD — critical write first, best-effort separately (allowed to fail)
await supabase.from('t').update({ sent_at: new Date() }).eq('id', id);
await supabase.from('t').update({ best_effort_col: x }).eq('id', id);  // non-fatal
```

## Pre-push checklist

```bash
npm test                                                  # 1. full suite
grep -rn "functionYouChanged" bot/shared/ bot/workers/ --include="*.js"  # 2. no broken references
```

## Related Skills

- [pre-merge-checklist](../pre-merge-checklist/SKILL.md) — the bug classes these checks defend against.
- [coaching](../coaching/SKILL.md) — a heavy consumer of the shared services above.
