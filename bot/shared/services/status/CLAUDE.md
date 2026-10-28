# status — Decision for the /status reply before anything is sent

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/status kg=c060236bb2ba gen=8e40abbd559a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `status-command.js` — decideStatusReply
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `status-command.js` | Decides the /status reply before sending: Flow CTA only when something is running, else a plain answer |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `status-command.js` ← imported by `bot/shared/handlers/text-message.handler.js:2378:ffcdf824`

## Never (human)
- Don't open the Flow when nothing runs: INIT returns a terminal screen (`bot/shared/services/status/status-command.js:8`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/status/status-command.test.js` (status-command.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/status/CLAUDE.md`?
