# app-funnel — App funnel telemetry: journey ids, action logging and funnel endpoints

<!-- kg:meta repo=NIETE-Rumi dir=tests/app-funnel kg=5cc86a0f4b9e gen=f287f3b2277d overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `journey-token.test.js` — journey id minted by the bot, carried inside the encrypted /go token
- `mount-order.test.js` — wiring guard for dashboard/index.js (no suite loads it)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/app-funnel --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `app-login-journey.test.js` | bd-4r3rei: GET /go/:token carries the journey id from the link into the session and app_link.open; old links still work |
| `route-parity.test.js` | bd-4r3rei: portal funnel-route.cjs and the bot app-journey normalise routes by the same rule |
| `CLAUDE.md` | (unmapped) |
| `bot-journey-events.test.js` | bd-4r3rei: bot half of the funnel; redirectIfFlagged emits command, link_sent and link_failed sharing one journeyId |
| `funnel-events-route.test.js` | bd-4r3rei: POST /api/portal/funnel/events auth rules (401 without portal session) and what the page may report |
| `journey-token.test.js` | bd-4r3rei: journey id is opaque, URL-safe, minted by the bot and carried inside the encrypted /go token |
| `action-logger.test.js` | bd-4r3rei: server logs app_funnel.action for key teacher actions on request success, with no ids or query strings |
| `dc-upload-failed-route.test.js` | bd-1d6g8o: POST /api/portal/funnel/dc-upload-failed logs dc_upload.failed using session identity and only known fields |
| `mount-order.test.js` | bd-4r3rei: guards dashboard/index.js wiring: action logger before portal routers, funnel route on portal CORS |

## Who reads this (generated)
- (none)

## Never (human)
- Never log ids, tokens or query strings in app_funnel.action (tests/app-funnel/action-logger.test.js:79)
- Teacher identity comes from the session, never the request body (tests/app-funnel/dc-upload-failed-route.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `portal/src/lib/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/app-funnel/CLAUDE.md`?
