# flows — WhatsApp Flow JSON definitions the bot publishes to Meta

<!-- kg:meta repo=NIETE-Rumi dir=bot/docs/flows kg=cbb0e5476f5d gen=f8eedd611941 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `registration-flow.json` — registration form screens and routing
- `observe-visit-flow.json` — coach /observe visit menu
- `observe-fico-flow.json` — FICO review screens
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `registration-flow.json` | WhatsApp Flow JSON (v6.3) for teacher registration: personal, region, professional, org screens |
| `observe-fico-flow.json` | WhatsApp Flow JSON (v6.3) for the 4-screen FICO coaching review (DOMAIN_B..F); loaded by observe-mewaka-endpoint.js |
| `observe-visit-flow.json` | WhatsApp Flow JSON (v7.0) for the coach /observe visit menu: debriefs, schedule, school and teacher pick |

## Who reads this (generated)
- (none)

## Never (human)
- A new Flow is one entry in bot/scripts/setup/flow-configs.js plus its JSON here (flow-configs.js:7-8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/docs/CLAUDE.md`?
