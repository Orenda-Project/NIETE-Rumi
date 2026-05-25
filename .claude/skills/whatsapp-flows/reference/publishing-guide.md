# WhatsApp Flows — Publishing & API Management

All commands use the Meta Graph API. `$TOKEN` is your WhatsApp access token, `$WABA_ID` your WhatsApp
Business Account id, `$FLOW_ID` the Flow's id — all from env, never inline.

## Upload / register a Flow's JSON

Register the Flow JSON through the bot's registration script (it reads the local Flow configs and pushes
them to your WABA). Re-run it after **any** local JSON change — editing the file alone does not update Meta.

## Publish a Flow (IRREVERSIBLE)

```bash
curl -X POST "https://graph.facebook.com/v18.0/$FLOW_ID/publish" \
  -H "Authorization: Bearer $TOKEN"
```

After publishing, the JSON can no longer be edited — create a new Flow if you need changes.

## Check Flow status

```bash
curl "https://graph.facebook.com/v18.0/$FLOW_ID?fields=name,status" \
  -H "Authorization: Bearer $TOKEN"
```

## Download the current Flow JSON from Meta

```bash
curl "https://graph.facebook.com/v18.0/$FLOW_ID/assets" \
  -H "Authorization: Bearer $TOKEN"
# then GET the returned download_url
```

## List all Flows on the WABA

```bash
curl "https://graph.facebook.com/v18.0/$WABA_ID/flows" \
  -H "Authorization: Bearer $TOKEN"
```

## Sending a Flow from code

### data_exchange mode (endpoint-driven)

```js
// No screen param → data_exchange mode (the endpoint handles INIT)
await WhatsAppService.sendFlow(phone, {
  flowId: FLOW_ID,
  flowToken: `${userId}:flowtype:${Date.now()}`,
  header: 'Flow Title',
  body: 'Description text',
  buttonText: 'Open',
});
```

### navigate mode (static, pre-fill on first screen)

```js
// screen param → navigate mode (pre-fills ONLY the first screen)
await WhatsAppService.sendFlow(phone, {
  flowId: FLOW_ID,
  flowToken: `${userId}:flowtype:${Date.now()}`,
  screen: 'FIRST_SCREEN',
  navigateData: { field1: 'value1' },
  header: 'Flow Title',
  body: 'Description text',
  buttonText: 'Open',
});
```

For endpoint-based flows, prefer data_exchange + INIT pre-fill over navigate mode.

## Endpoint action handling

```js
if (action === 'INIT')          return { screen: 'FIRST_SCREEN', data: {} };
if (action === 'data_exchange') return { screen: 'NEXT_SCREEN', data: {} }; // validate + save first
if (action === 'BACK')          return { screen: 'PREVIOUS_SCREEN', data: {} };
if (action === 'ping')          return { data: { status: 'active' } };
```

## Flow token best practice

```js
await WhatsAppService.sendFlow(from, { flowId: FLOW_ID, flowToken: user.id }); // CORRECT
// parse in the endpoint:
const userId = (flow_token || '').split(':')[0];
```

## Testing

```js
it('returns a screen with no version field', async () => {
  const result = await handleSetupInit('user-123');
  expect(result.version).toBeUndefined();   // CRITICAL
  expect(result.screen).toBe('CLASS_INFO');
  expect(result.data).toBeDefined();
});

it('returns all declared data fields', async () => {
  const result = await handleAddItem(/* ... */);
  expect(result.data.list_id).toBeDefined();
  expect(result.data.item_count).toBeDefined();
});
```

## External references

- [Meta — WhatsApp Flows](https://developers.facebook.com/docs/whatsapp/flows)
- [Meta — Flow JSON reference](https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson)
- [Meta — Flows data-exchange endpoint](https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint)
