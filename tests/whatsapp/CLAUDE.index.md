# whatsapp — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/whatsapp -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `helpers/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `extract-key-leading-slash.test.js` | bd-8s0dp: r2 extractKeyFromUrl strips leading slashes on bare keys so feature intro videos are sent |
| `inbound-typing-scope.test.js` | bd-0wrn4: inbound typing scope through the real WhatsApp service: replies to others, same-person replies and reactions |
| `inbound-typing.test.js` | bd-0wrn4: typing is not left on screen after a reaction-only or empty reply, sticker, or silent receipt |
| `password-reset-sync-budget.test.js` | Pins that POST /api/internal/send-password-reset answers the portal inside its 10 s timeout despite send pacing |
| `send-audio-media-id.test.js` | Pins that sendAudio logs and surfaces the uploaded media id so the exact voice note bytes can be fetched back |
| `send-audio-voice-flag.test.js` | Pins that Ogg Opus voice notes are sent with audio.voice=true (waveform) while an MP3 goes as plain audio |
| `send-image-buffer-with-buttons.test.js` | Pins sendImageBufferWithButtons: upload bytes then one buttons message with image header, 20-code-point titles |
| `send-image-from-url.test.js` | bd-1881: sendImageFromUrl exists, downloads the R2 object to a file path, sends, and cleans up the temp file |
| `send-media-message-id.test.js` | bd-v0toag.12: sendImage and sendAudio hand Meta's wamid to opts.onMessageId, nothing changes without opts |
| `send-no-recipient.test.js` | bd-mo5pru: sendMessage never calls Meta without a recipient; logs whatsapp.send.no_recipient at warn |
| `send-pacing.redis.test.js` | Runs the per-recipient reservation Lua script against real Redis: burst, distinct concurrent slots, penalties |
| `send-pacing.test.js` | Pins per-recipient send pacing and retry of Meta 131056 rate-limit refusals on text, buttons and documents |
| `send-sync-budget.test.js` | Pins that a send an HTTP response waits on (Flow data_exchange) never waits out the pacing schedule (ifLate) |
| `send-temp-collision.test.js` | bd-c00np: concurrent media sends in the same millisecond each upload their own bytes; temp files cleaned up |
| `send-template.test.js` | bd-1881: WhatsAppService.sendTemplate exists, POSTs a type:template payload and passes the language code |
| `send-voicenote-result.test.js` | Pins that sendVoicenoteFromR2Key returns true for an accepted voicenote and false for a refused one |
| `webhook-calls-forward.test.js` | bd-1hae7.20: a WhatsApp call webhook is forwarded, authenticated, to the calls service, never to message handling |
| `webhook-signature.test.js` | Pins POST /webhook and Flow endpoint X-Hub-Signature-256 HMAC checks: signed processed, unsigned 401, tampered refused |

## Who reads this (all, generated)
- env `R2_BUCKET_NAME` read at `tests/whatsapp/extract-key-leading-slash.test.js:15:cd560242`
- env `REDIS_TEST_URL` read at `tests/whatsapp/send-pacing.redis.test.js:14:b0c49f82`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `tests/whatsapp/extract-key-leading-slash.test.js:14:cd796d8a`
- env `SUPABASE_URL` read at `tests/whatsapp/extract-key-leading-slash.test.js:13:d1ac37ba`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/whatsapp/CLAUDE.index.md`? · `tests/whatsapp/CLAUDE.md`?
