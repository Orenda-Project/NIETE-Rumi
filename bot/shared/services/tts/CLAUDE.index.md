# tts — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/tts -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `providers/` | Concrete TTS vendors: ElevenLabs, OpenAI and Soniox behind the gateway → `providers/CLAUDE.md` |
| `text/` | → (no door; 2 files) |
| `index.js` | Voice gateway: the one entry (synthesize) any feature uses to get a voice note, routed by use case |
| `ogg-opus.js` | Ogg Opus toolkit: parse, check completeness, measure duration and join clips for the TTS gateway |
| `routing.js` | Routes a TTS use case to an ordered provider chain from configuration (resolveChain) |

## Who reads this (all, generated)
- `index.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:102:d4fc4e89` · `bot/scripts/quiz/record-one-voice-shared-lines.js:163:84470ea7` · `bot/scripts/quiz/record-welcome-lines.js:58:d4fc4e89` · `bot/shared/handlers/voice-message.handler.js:11:a571448f` (+7: `python3 kg/kg.py who-reads index.js`)
- `ogg-opus.js` ← imported by `bot/shared/services/tts/index.js:22:109dfb74` · `bot/shared/services/tts/providers/soniox.provider.js:30:7656355b`
- `routing.js` ← imported by `bot/shared/services/tts/index.js:21:eda33c95`

## Tests (all, generated)
- `index.js` ← `bot/tests/quiz/backfill-bank-quiz-audio.test.js` · `bot/tests/quiz/one-voice-missing-keys.test.js` · `bot/tests/quiz/web-quiz/challenge-clip-warm.test.js` · `bot/tests/quiz/web-quiz/web-quiz-audio-cap-one.test.js` · `bot/tests/quiz/web-quiz/web-quiz-bank-voice.test.js` · `bot/tests/quiz/web-quiz/web-quiz-challenge-listen.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/services/tts/index.js`)
- `ogg-opus.js` ← `tests/tts/ogg-opus.test.js` · `tests/tts/soniox.provider.test.js`
- `routing.js` ← `tests/tts/routing.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/customization.md`?
