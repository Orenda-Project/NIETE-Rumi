# whatsapp — Tests WhatsApp senders, send pacing, inbound typing and webhook signature checks
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/whatsapp kg=02725bad63bf gen=9acafe792ed7 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `webhook-signature.test.js` — X-Hub-Signature-256 HMAC enforcement on webhook and Flows
- `send-pacing.test.js` — per-recipient pacing and 131056 retry
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/whatsapp --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `helpers/` | → (no door; 1 files: 0 test + 1 support) |
| `send*` | 12 files; most used `send-sync-budget.test.js`: Pins that a send an HTTP response waits on (Flow data_exchange) never waits out the pacing schedule (ifLate) |
| `webhook-signature.test.js` | Pins POST /webhook and Flow endpoint X-Hub-Signature-256 HMAC checks: signed processed, unsigned 401, tampered refused |
| `password-reset-sync-budget.test.js` | Pins that POST /api/internal/send-password-reset answers the portal inside its 10 s timeout despite send pacing |
| `inbound-typing-scope.test.js` | bd-0wrn4: inbound typing scope through the real WhatsApp service: replies to others, same-person replies and reactions |
| `inbound-typing.test.js` | bd-0wrn4: typing is not left on screen after a reaction-only or empty reply, sticker, or silent receipt |
| `webhook-calls-forward.test.js` | bd-1hae7.20: a WhatsApp call webhook is forwarded, authenticated, to the calls service, never to message handling |
| `extract-key-leading-slash.test.js` | bd-8s0dp: r2 extractKeyFromUrl strips leading slashes on bare keys so feature intro videos are sent |

## Who reads this (generated)
- (none)

## Never (human)
- Webhook POSTs must be HMAC-verified: unsigned gets 401 (webhook-signature.test.js:5)
- A send an HTTP response waits on must not wait out pacing (send-sync-budget.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.md`? · `tests/CLAUDE.md`?
