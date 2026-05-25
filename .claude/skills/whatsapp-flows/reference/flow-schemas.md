# WhatsApp Flows — Schema Reference

## Flow JSON top-level structure

```json
{
  "version": "6.3",
  "data_api_version": "3.0",
  "routing_model": {
    "SCREEN_A": ["SCREEN_B", "SCREEN_C"],
    "SCREEN_B": ["SUCCESS"],
    "SCREEN_C": ["SUCCESS"],
    "SUCCESS": []
  },
  "screens": []
}
```

## Screen structure

```json
{
  "id": "SCREEN_NAME",
  "title": "Display Title",
  "terminal": false,
  "refresh_on_back": true,
  "data": {
    "field_name":   { "type": "string", "__example__": "example value" },
    "numeric_field":{ "type": "number", "__example__": 42 },
    "array_field": {
      "type": "array",
      "items": { "type": "object", "properties": {
        "id":    { "type": "string" },
        "title": { "type": "string" }
      } },
      "__example__": [{ "id": "1", "title": "Item 1" }]
    }
  },
  "layout": {}
}
```

## Data binding rules

Every field your endpoint returns MUST be declared in the screen's `data` object.

```json
{ "type": "TextHeading", "text": "Students in ${data.class_display}" }
```

If `${data.xxx}` shows as literal text, check:
1. the field is declared in the screen's `data` object;
2. the endpoint response includes the field;
3. the data types match the declaration;
4. there is no `version` field in the endpoint response.

## Looping screens

For a screen that returns to itself (e.g. adding multiple items):

```json
{
  "id": "ADD_ITEM",
  "refresh_on_back": true,
  "data": {
    "item_count":  { "type": "number", "__example__": 0 },
    "items_added": { "type": "array", "items": {}, "__example__": [] }
  }
}
```

- `routing_model` must NOT include the self-loop: use `"ADD_ITEM": ["SUCCESS"]`, not `["ADD_ITEM", "SUCCESS"]`.
- The screen CAN navigate to itself via `data_exchange`, just not in `routing_model`.
- The endpoint response for the loop must include ALL declared fields:

```js
return { screen: 'ADD_ITEM', data: { item_count: newCount, items_added: updatedList } };
```

## Form init-values (pre-filling fields)

Form-level `init-values` pre-selects/pre-fills form children. Keys must match each child component's `name`.

```json
{
  "type": "Form",
  "name": "settings_form",
  "init-values": {
    "language":  "${data.current_language}",
    "framework": "${data.current_framework}"
  },
  "children": [
    { "type": "Dropdown", "name": "language",  "data-source": "${data.languages}" },
    { "type": "Dropdown", "name": "framework", "data-source": "${data.frameworks}" }
  ]
}
```

| Component | init-values works? | Notes |
|-----------|-------------------|-------|
| Dropdown | yes | pre-selects matching id |
| RadioButtonsGroup | yes | pre-selects matching option |
| CheckboxGroup | yes | pre-checks matching options |
| TextInput | yes | MUST use Form-level init-values |
| TextArea | likely | treat like TextInput |

**Component-level `init-value` on a TextInput inside a Form is NOT supported — always use Form-level
`init-values`.** Each pre-fill value needs its own `data` declaration on the screen.

## Errors history (common root causes)

| Error | Root cause | Fix |
|-------|-----------|-----|
| "Something went wrong" | `version` field in response | Remove the version field |
| Dropdown blank | dynamic data-source not resolving | Use an inline static data-source |
| `${data.xxx}` literal | field not declared in screen `data` | Add it to the screen's `data` object |
| UUID invalid syntax | `flow_token` auto-generated | Pass `flowToken: user.id` |
| Loop in `routing_model` | self-reference in routing | Remove the self-loop |
| Duplicate key constraint | creating an existing record | Check existence before insert |
| init-values not applying | Flow is DRAFT | Publish the Flow |
