# status — Decision for the /status reply before anything is sent

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/status kg=c060236bb2ba gen=92d30df2defa overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `status-command.js` — decideStatusReply
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `status-command.js` | Decides the /status reply before sending: Flow CTA only when something is running, else a plain answer |

## Who reads this (generated)
- `status-command.js` ← imported by `bot/shared/handlers/text-message.handler.js:2378:ffcdf824`

## Never (human)
- Don't open the Flow when nothing runs: INIT returns a terminal screen (`bot/shared/services/status/status-command.js:8`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/status/status-command.test.js` (status-command.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
