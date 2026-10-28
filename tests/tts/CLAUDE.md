# tts — Tests the text-to-speech gateway, providers (ElevenLabs, Soniox) and Ogg Opus handling

<!-- kg:meta repo=NIETE-Rumi dir=tests/tts kg=2a0965c84750 gen=fe13803430c5 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `gateway.test.js` — provider choice with real providers, mocked network
- `routing.test.js` — TTS_PROVIDER and per-use-case overrides
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/tts --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `gateway.test.js` | Pins tts.synthesize provider choice with real providers and a mocked network: default ElevenLabs, Soniox, per use case |
| `soniox.provider.test.js` | Pins the Soniox provider with real audio fixtures: config, default voices per language, truncated stream handling |
| `CLAUDE.md` | (unmapped) |
| `routing.test.js` | Pins tts resolveChain: TTS_PROVIDER and per-use-case overrides choose the provider order with fallbacks |
| `elevenlabs.provider.test.js` | Pins that the ElevenLabs provider sends the exact pre-gateway request (voice, model, settings, Ogg Opus) per language |
| `ogg-opus.test.js` | Pins the ogg-opus toolkit: Ogg CRC-32, OpusHead and header packet parsing on real clips, duration checks |
| `normalizers.test.js` | Pins the per-language TTS text normalizer table (Urdu clean-up; other languages spoken as written) |
| `soniox-text.test.js` | Pins prepareForSoniox and splitForSoniox: keycap, symbol and hyphen text preparation and request splitting |

## Who reads this (generated)
- env read here: `ELEVENLABS_API_KEY` · `OPENAI_API_KEY`

## Never (human)
- With TTS_PROVIDER unset, requests must match the pre-gateway ones (elevenlabs.provider.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/tts/CLAUDE.index.md`? · `bot/shared/services/tts/providers/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/customization.md`? · `tests/CLAUDE.index.md`? (+2)
