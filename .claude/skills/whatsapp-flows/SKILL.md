---
name: whatsapp-flows
description: Build and manage WhatsApp Flows — endpoint data exchange, form pre-fill, DRAFT vs PUBLISHED, the Meta publish lifecycle, and the three wiring points a new Flow needs.
---

# WhatsApp Flows Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [registration](../registration/SKILL.md), [debugging](../debugging/SKILL.md)

WhatsApp Flows are interactive forms rendered inside WhatsApp. The bot drives them through a webhook
**endpoint** (data exchange) and registers/publishes the Flow JSON via the Meta Graph API. These rules are
the hard-won ones — get any wrong and the Flow fails silently with "Something went wrong".

## Critical rules

### 1. NEVER include a `version` field in the endpoint response

```js
return { screen: 'NEXT_SCREEN', data: { field1: 'value1' } };          // CORRECT
return { version: '3.0', screen: 'NEXT_SCREEN', data: { ... } };       // WRONG — silent failure
```

### 2. DRAFT flows do NOT reliably apply init-values — publish before testing pre-fill

| Status | init-values | Can edit JSON? |
|--------|-------------|----------------|
| DRAFT | unreliable | yes |
| PUBLISHED | works | **no — irreversible** |

Publishing is irreversible; to change a published Flow's JSON, create a **new** Flow.

### 3. Flow token MUST be the user id (not auto-generated)

```js
await WhatsAppService.sendFlow(from, { flowId: FLOW_ID, flowToken: user.id });   // CORRECT
await WhatsAppService.sendFlow(from, { flowId: FLOW_ID });                       // WRONG — useless "flow_123..." token
```

### 4. Use Form-level `init-values`, not component-level `init-value`

Component-level `init-value` on a `TextInput` inside a `Form` is not supported by Meta. Always bind at the
Form level with an object literal.

### 5. Every returned field MUST be declared in the screen's `data` object

If `${data.xxx}` renders as literal text, the field is missing from that screen's `data` declaration.

### 6. Edit-then-REPUBLISH — a local JSON change does NOT update Meta

Editing the Flow JSON on disk does **not** update Meta. Meta keeps serving the previously-published JSON
until you re-run the Flow registration script (and the Flow is in that script's list). When you add a new
Flow, add it to the registration script too.

### 7. `routing_model` is FORWARD-ONLY

Meta rejects publish (`INVALID_ROUTING_MODEL`) if `routing_model` declares any backward route. Instead,
re-fetch state on the destination screen, or accept "one edit per visit" and re-enter the Flow.

### 8. `data_exchange` has a ~10s timeout — long work goes async

Meta times the endpoint out at ~10s. LLM generation, uploads, slow third-party calls **must** be kicked off
via `setImmediate` *after* returning SUCCESS; the user gets a chat confirmation a few seconds later.

```js
async function handleCompleteAction(userId, payload) {
  setImmediate(async () => { await SomeService.doExpensiveWork(userId, payload); }); // ~30s
  return { screen: 'SUCCESS', data: { success_message: 'Working on it…', extension_message_response: { params: {} } } };
}
```

### 9. The endpoint health-check blocks publish

Meta probes the endpoint URL before allowing publish; if it isn't deployed yet, publish fails with
`error_subcode: 4233014` ("Endpoint not available"). **Order: commit + push → wait for deploy → publish.**

### 10. A NEW Flow ID requires THREE wiring points

Without all three, submissions fall through to the generic unknown-flow reply:

1. [bot/shared/utils/flow-type-detector.js](../../../bot/shared/utils/flow-type-detector.js) — recognise the submission shape (cleanest: tag it in `extension_message_response.params` and detect by that field).
2. [bot/whatsapp-bot.js](../../../bot/whatsapp-bot.js) — a handler branch in the `nfm_reply` switch (alongside the existing flow-type branches).
3. [bot/shared/handlers/flow-response.handler.js](../../../bot/shared/handlers/flow-response.handler.js) — at minimum a no-op return.

### 11. Contextual chat ack after submit

Don't bounce the user to "Type /menu". Tag the action in `extension_message_response.params` and dispatch a
contextual ack from the `nfm_reply` branch.

## Endpoint response formats

```js
return { screen: 'NEXT_SCREEN', data: { field1: 'value1' } };                  // navigate
return { data: { error: { message: 'User-friendly error' } } };                // error
return { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: flowToken } } } }; // complete
```

## Common errors

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Something went wrong" | `version` field in response | Remove it |
| `${data.xxx}` literal text | Field not in screen `data` | Add it |
| Dropdown blank | Dynamic data-source issue | Use an inline static data-source |
| init-values not applying | Flow is DRAFT | Publish it |
| "loop detected in routing" | Screen routes to itself | Remove the self-reference |

## Debugging checklist

1. Check the bot's logs — the real error is there, not in the WhatsApp UI (see [debugging](../debugging/SKILL.md)).
2. No `version` field in the response.
3. All returned fields declared in the screen `data`.
4. `flow_token` is the user id.
5. Flow is PUBLISHED if testing init-values.
6. Re-publish after any Flow JSON change.

## Reference Files

| File | Contents |
|------|----------|
| [reference/flow-schemas.md](reference/flow-schemas.md) | Flow JSON structure, screen schema, data binding, looping screens, init-values component support |
| [reference/publishing-guide.md](reference/publishing-guide.md) | Meta Graph API commands (publish/list/download), sending flows (data_exchange vs navigate), action handling, testing patterns |

## Related Skills

- [registration](../registration/SKILL.md) — the Registration Flow is the canonical example of these rules.
- [debugging](../debugging/SKILL.md) — where the real Flow error surfaces.
