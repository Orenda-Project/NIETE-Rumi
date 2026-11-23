# data-analyst — The data team's governed data analyst, answering on WhatsApp behind a per-person switch

## Entry points
- `entry.js` — no mode: a data-looking message goes straight to the analyst; "data" opens the Flow; each answer carries 'Ask another' / 'Main menu'; a 10-min follow-up window closes by itself; 30 questions a day
- `answering.js` — one answer: the data MCP as this person, the proxy, the loop, cost logged under `job: data_analyst`
- `tool-proxy.js` — their Slack bot's gates, ported (rules first, ungoverned tables, compiled first, auth), plus ICT only

## Children
| path | purpose |
|---|---|
| `classifier.js` | is this a data question? Bot words, numbers, under 3 words: no (no model call); else a one-word Haiku verdict DATA / NORMAL / UNSURE; any failure is NORMAL |
| `chart.js` | their `charting/select.py` rules (which result is a chart) + their Studio SVG (line with halftone, track bars), as a PNG card via `htmlToImage`; null on any failure. Too wide for their rules: the headline measures (≤3, named by the question, else the first) are drawn and the rest come back as `spec.rest` lines; `breakdownLines` lists every row when there is no chart |
| `switch.js` | app_settings `data_analyst_whatsapp`: a JSON list of users.id or {id, email}; `true` is OFF; read once a minute |
| `mcp-client.js` | JSON-RPC to their `/mcp`, with the surface header (`whatsapp`) and the asker's address on every call |
| `prompt.js` | their SYSTEM_PROMPT verbatim, their "today" block, then one block of what WhatsApp changes |
| `brain.js` | their tool loop: one rolling cache breakpoint, parallel queries once rules are read, 240 s then a tools-off wrap-up |
| `memory.js` | the conversation's queries, rule reads and open question, round-tripped through Redis with the session |
| `whatsapp-format.js` | disclosures, footer (NIETE data · window · rules version); `composeReply` cuts a charted answer to 2 lines for the image caption; asks become list rows |
| `vendor/` | `data-mcp-contract.json` (their prompt, tool schemas, refusal texts, compiled-figure tables) and the script that made it |

## Switching it on (per tier)
1. Env: `DATA_MCP_URL`, `DATA_MCP_USER_EMAIL` (and `ANTHROPIC_API_KEY`, already set). Optional knobs in `.env.template`.
   `DATA_ANALYST_FLOW_ID`: register `docs/flows/data-question.json` with `node bot/scripts/setup/register-one-flow.js "Data Question"` on that tier's WABA; unset, "data" sends a list of the 4 quick picks instead.
2. Row: `app_settings` key `data_analyst_whatsapp`, value a JSON list, e.g. `["<users.id>"]`. No row = off for everyone.
3. Check figures first: `DATA_MCP_SURFACE=whatsapp-dev node bot/scripts/data-analyst/ask.js "<question>" --trace`.

## Never (human)
- Never edit `vendor/data-mcp-contract.json` by hand: regenerate it with `vendor/vendor_contract.py` from their repo at the version their live MCP runs, and re-run `tests/data-analyst`
- Never add a person by `true` or "everyone": one list entry per person, each asked as an address their side accepts
- Never answer outside ICT here (region `niete-rumi`): the proxy refuses other regions and programmes before the MCP, and fills program `niete-rumi` on every metric call and rules read that names none
- Never bring back a sticky data mode (21 Nov: people forget how to leave it; the "Menu to leave" line scrolls out of sight). Every answer carries its own buttons
- Never send the bot's own words (menu, lesson plan, observe, training, quiz…), `da_*` buttons or Flow replies to the classifier
- Never drop a measure or a row silently: what the chart leaves out is listed under it, and with no chart every row is listed (bd-bhgw20.4)

## Tests
- `tests/data-analyst/*.test.js` — switch, client, prompt (golden "today" cases from their code), proxy gates, loop, format, door, classifier, chart, Flow, webhook wiring
- Sample charts from real answers: `node bot/scripts/data-analyst/ask.js "<q>" --png <dir>`
