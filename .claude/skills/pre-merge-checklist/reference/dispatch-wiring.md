# Dispatch Wiring — Concrete Patterns

WhatsApp delivers four distinct webhook shapes. Each ID your bot emits arrives through ONE of them, and
only ONE handler branch can dispatch it. Before merging, verify every emitted ID is matched by a dispatcher.

## The four webhook shapes

### 1. Free-message interactive button

**Webhook**: `messageType === 'interactive'`, `interactive.type === 'button_reply'`, `id` = your string.

```js
// emit
await WhatsAppService.sendInteractiveButtons(phone, {
  body: '...',
  buttons: [
    { id: 'my_feature_yes_<ctx>', title: 'Yes' },
    { id: 'my_feature_no_<ctx>',  title: 'No' },
  ],
});

// receive — whatsapp-bot.js button_reply branch
} else if (messageType === 'interactive' && message.interactive?.type === 'button_reply') {
  const buttonId = message.interactive.button_reply.id;
  if (buttonId.startsWith('my_feature_')) { /* dispatch */ }
  else { logToFile('⚠️ Unknown button ID', { buttonId }); }
}
```

### 2. Free-message interactive list row

**Webhook**: `messageType === 'interactive'`, `interactive.type === 'list_reply'`, `id` = your string.

```js
// emit
await WhatsAppService.sendInteractiveMessage(phone, {
  body: '...',
  action: { button: 'Pick one', sections: [{ title: 'Options', rows: [
    { id: 'my_feature_pick_<itemId>', title: 'Item' },
  ]}]},
});

// receive — whatsapp-bot.js list_reply branch
} else if (messageType === 'interactive' && message.interactive?.type === 'list_reply') {
  const listId = message.interactive.list_reply.id;
  if (listId.startsWith('my_feature_pick_')) { /* dispatch */ }
  else { logToFile('⚠️ Unknown list item ID', { listId }); }
}
```

### 3. Template quick-reply button

**Webhook**: `messageType === 'button'`, `button.text` = the button label, `button.payload` empty unless set
in the template definition. Templates don't carry a custom `id` — **match by `button.text`** (include every
language string), or by `button.payload` if you set one.

```js
// receive — whatsapp-bot.js button (template) branch
} else if (messageType === 'button' && message.button) {
  const buttonText = message.button.text;
  if (buttonText && /^(My Feature Action|<other-language label>)$/i.test(buttonText.trim())) {
    /* dispatch — match by TEXT since most templates don't set a payload */
  }
}
```

### 4. Free text

**Webhook**: `messageType === 'text'`, `text.body` = whatever the user typed (e.g. `A`/`B`/`STOP` instead of
tapping). Intercept it in `text-message.handler.js` **before the registration gate** if the recipient may be
an unregistered user (parents, students), so they aren't forced through onboarding:

```js
// EARLY intercept — before the registration gate
if (messageBody) {
  try {
    const MyService = require('../services/my-feature/my-service');
    const state = await MyService.getActiveState(from);
    if (state) {
      const t = messageBody.trim();
      if (/^[ABC]$/i.test(t) && state.currentQuestionId) { await MyService.handleAnswer(from, t, state); return; }
      if (t.toUpperCase() === 'STOP') { await MyService.endSession(from, state, 'incomplete'); return; }
      await WhatsAppService.sendMessage(from, '❓ Type A, B, or C — or STOP to exit.'); return;
    }
  } catch (e) { /* non-fatal — fall through */ }
}
```

## Whole-feature wiring checklist

For a feature emitting IDs across several shapes (invite buttons → answer buttons → text answers):

```bash
# 1. List every ID the service emits
grep -rEn "id:\s*['\"]?(\$\{)?[a-z_]+" --include="*.js" bot/shared/services/<feature>/ | sort -u
# 2. Each prefix must turn up a dispatcher:
grep -n "your_prefix" bot/whatsapp-bot.js                               # button_reply / list_reply / template
grep -n "your_prefix\|state.currentQuestionId" bot/shared/handlers/text-message.handler.js  # text intercept
grep -n "your_flow_id" bot/shared/utils/flow-type-detector.js          # if you added a Flow
grep -n "your_flow_id" bot/shared/handlers/flow-response.handler.js    # if you added a Flow
```

Any prefix with a service-side emit but no receiver-side dispatcher is an orphan that no-ops in production.

## Lock it in with a mock-free test

```js
describe('My feature dispatch contract', () => {
  test('my_feature_start has a button_reply dispatcher', () => {
    const src = fs.readFileSync('bot/whatsapp-bot.js', 'utf8');
    expect(src).toMatch(/buttonId === ['"]my_feature_start['"]/);
  });
  test('my_feature_pick_* has a list_reply dispatcher', () => {
    const src = fs.readFileSync('bot/whatsapp-bot.js', 'utf8');
    expect(src).toMatch(/listId\.startsWith\(['"]my_feature_pick_['"]\)/);
  });
});
```

These just grep the source — cheap, fast, and they catch the orphan-dispatch class entirely.
