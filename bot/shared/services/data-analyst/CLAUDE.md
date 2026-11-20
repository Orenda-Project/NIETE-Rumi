# data-analyst — The data team's governed data analyst, answering on WhatsApp behind a per-person switch

## Entry points
- `entry.js` — the door before the text handler: "data" enters, "menu" or 30 min idle leaves, 30 questions a day
- `answering.js` — one answer: the data MCP as this person, the proxy, the loop, cost logged under `job: data_analyst`
- `tool-proxy.js` — their Slack bot's gates, ported (rules first, ungoverned tables, compiled first, auth), plus ICT only

## Children
| path | purpose |
|---|---|
| `switch.js` | app_settings `data_analyst_whatsapp`: a JSON list of users.id or {id, email}; `true` is OFF; read once a minute |
| `mcp-client.js` | JSON-RPC to their `/mcp`, with the surface header (`whatsapp`) and the asker's address on every call |
| `prompt.js` | their SYSTEM_PROMPT verbatim, their "today" block, then one block of what WhatsApp changes |
| `brain.js` | their tool loop: one rolling cache breakpoint, parallel queries once rules are read, 240 s then a tools-off wrap-up |
| `memory.js` | the conversation's queries, rule reads and open question, round-tripped through Redis with the session |
| `whatsapp-format.js` | disclosures from the payloads, footer (NIETE data · window · rules version), numbered asks and follow-ups |
| `vendor/` | `data-mcp-contract.json` (their prompt, tool schemas, refusal texts, compiled-figure tables) and the script that made it |

## Switching it on (per tier)
1. Env: `DATA_MCP_URL`, `DATA_MCP_USER_EMAIL` (and `ANTHROPIC_API_KEY`, already set). Optional knobs in `.env.template`.
2. Row: `app_settings` key `data_analyst_whatsapp`, value a JSON list, e.g. `["<users.id>"]`. No row = off for everyone.
3. Check figures first: `DATA_MCP_SURFACE=whatsapp-dev node bot/scripts/data-analyst/ask.js "<question>" --trace`.

## Never (human)
- Never edit `vendor/data-mcp-contract.json` by hand: regenerate it with `vendor/vendor_contract.py` from their repo at the version their live MCP runs, and re-run `tests/data-analyst`
- Never add a person by `true` or "everyone": one list entry per person, each asked as an address their side accepts
- Never answer outside ICT here (region `niete-rumi`): the proxy refuses other regions and programmes before the MCP

## Tests
- `tests/data-analyst/*.test.js` — switch, client, prompt (golden "today" cases from their code), proxy gates, loop, format, door, webhook wiring
