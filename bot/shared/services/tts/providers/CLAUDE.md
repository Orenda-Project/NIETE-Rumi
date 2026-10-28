# providers — Concrete TTS vendors: ElevenLabs, OpenAI and Soniox behind the gateway

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/tts/providers kg=53140a0383c0 gen=81e65699f0c6 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `soniox.provider.js` — parallel parts joined into one stream
- `elevenlabs.provider.js` — pre-gateway voice and first fallback
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `soniox.provider.js` | Soniox TTS provider (TTS_PROVIDER=soniox): splits text, speaks parts in parallel, joins one Ogg Opus stream |
| `elevenlabs.provider.js` | ElevenLabs TTS provider adapter, the pre-gateway voice and first fallback behind other providers |
| `openai.provider.js` | OpenAI TTS provider, last voice in the default fallback chain, with Urdu digit clean-up |

## Who reads this (generated)
- `elevenlabs.provider.js` ← imported by `bot/shared/services/tts/index.js:24:c75eac2d`
- `openai.provider.js` ← imported by `bot/shared/services/tts/index.js:25:4ea35da4`
- `soniox.provider.js` ← imported by `bot/shared/services/tts/index.js:23:f382144c`

## Never (human)
- ElevenLabs must send what the pre-gateway path sent (`bot/shared/services/tts/providers/elevenlabs.provider.js:7`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/tts/elevenlabs.provider.test.js` (elevenlabs.provider.js)
- `tests/tts/soniox.provider.test.js` (soniox.provider.js)

## Related (generated)
- docs: `bot/shared/services/tts/CLAUDE.index.md`? · `bot/shared/services/tts/CLAUDE.md`? · `bot/shared/services/tts/providers/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/agent-customization.md`? · `docs/customization.md`? (+1)
