# whatsapp — Tests for the WhatsApp transport: username senders and audio sending

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/whatsapp kg=97cb421fea6e gen=26e399fe8c77 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `phoneless-inbound.test.js` — webhook senders with no phone number
- `send-audio-absent-temp-dir.test.js` — sendAudio creates its temp dir, text fallback
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `phoneless-inbound.test.js` | Pins validateWebhookMessage for username users with no phone: carries from_user_id, falls back to contact wa_id |
| `send-audio-absent-temp-dir.test.js` | Pins that sendAudio creates its missing temp directory and that a failed voice send falls back to text |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- env read here: `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? (+2)
