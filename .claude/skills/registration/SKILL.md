---
name: registration
description: How a new user becomes a registered teacher — the post-first-feature name capture, the WhatsApp Registration Flow form, and the user fields that gate it.
---

# Registration Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [debugging](../debugging/SKILL.md)

A new user can talk to the bot and use features before they're "registered". Registration captures their
name (and, via the Flow form, richer profile fields) so later interactions are personalised. There are
**two paths**, both converging on the same `users` columns.

## Quick Reference

- **Service**: [bot/shared/services/feature-registration.service.js](../../../bot/shared/services/feature-registration.service.js) — the trigger logic and name capture.
- **Flow submission**: `handleRegistrationFlow` in [bot/shared/handlers/flow-response.handler.js](../../../bot/shared/handlers/flow-response.handler.js).
- **Flow encryption**: [bot/shared/services/flow-encryption.service.js](../../../bot/shared/services/flow-encryption.service.js) — decrypts WhatsApp Flow payloads.
- **Text entry**: [bot/shared/handlers/text-message.handler.js](../../../bot/shared/handlers/text-message.handler.js) — catches the name reply when a user is pending.

## Domain Knowledge

### Path 1 — conversational name capture (default)

The lightweight path, triggered **after the user's first completed feature**:

1. `FeatureRegistrationService.checkAndTriggerRegistration(userId, ...)` runs after a feature delivers.
2. It skips if the user is already registered (`first_name` set or `registration_completed = true`) or already mid-flow (`registration_pending_name = true`).
3. On the user's **first** feature only (`countUserFeatures(userId) === 1`), `sendNameQuestion(...)` asks their name in their language and sets `registration_pending_name = true`.
4. The next text turn is caught by `isPendingName(userId)` in the text handler → `handleNameResponse(...)` extracts the name, sets `first_name`, `registration_completed = true`, `registration_completed_at`, and clears `registration_pending_name`.

### Path 2 — WhatsApp Registration Flow (form)

A richer path using a WhatsApp Flow form. The submission webhook is decrypted by the flow-encryption
service and handled by `handleRegistrationFlow` in
[flow-response.handler.js](../../../bot/shared/handlers/flow-response.handler.js), which writes the full
profile to the `users` row and sets the same completion fields. The Flow is identified by a Registration
Flow ID configured in env. (For the Flow plumbing itself — endpoint data exchange, init-values, DRAFT vs
PUBLISHED — see the WhatsApp Flows skill once it lands.)

### The fields that gate registration

```sql
-- in the users table
first_name                  -- presence alone counts as "registered"
registration_completed      -- boolean; checked FIRST
registration_completed_at   -- timestamp
registration_pending_name   -- true while waiting for the name reply (path 1)
```

To force a clean re-registration, reset **all** of these (a half-reset leaves the user wedged):

```js
await supabase.from('users').update({
  first_name: null,
  registration_completed: false,
  registration_completed_at: null,
  registration_pending_name: false,
}).eq('id', userId);   // by UUID, never by phone
```

## Common Issues & Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| Registered user re-prompted | A reset left `registration_completed = true` but `first_name` null (or vice-versa) | Reset all four fields together. |
| Name reply ignored | `registration_pending_name` not set, so the text handler doesn't intercept | Confirm `sendNameQuestion` ran and set the flag. |
| `value too long for type character varying(N)` on a profile field | A Flow field exceeds its column width | Widen the column to fit the real input. |
| WhatsApp `(#100)` error on the prompt | Empty message body sent | Guard against an empty prompt string before sending. |
| Flow submitted but user not updated | Decryption or handler failure | Trace the correlation id through `handleRegistrationFlow` — see [debugging](../debugging/SKILL.md). |

## Example — find users stuck mid-registration

```sql
SELECT id, phone_number, first_name, registration_completed, registration_pending_name
FROM users
WHERE registration_pending_name = true
ORDER BY updated_at DESC;
```

## Related Skills

- [debugging](../debugging/SKILL.md) — trace a failed Flow submission or a stuck name capture by correlation id.
