# tts — Voice gateway for all voice notes: routing, providers, Ogg Opus and text prep
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/tts kg=acf5e128ad6c gen=ceac2d764f4f overflow=9 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.js` — synthesize, the one entry features call
- `routing.js` — use case to ordered provider chain
- `ogg-opus.js` — stream validation, duration, joining
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `providers/` | Concrete TTS vendors: ElevenLabs, OpenAI and Soniox behind the gateway → `providers/CLAUDE.md` |
| `text/` | → (no door; 2 files) |
| `index.js` | Voice gateway: the one entry (synthesize) any feature uses to get a voice note, routed by use case |
| `ogg-opus.js` | Ogg Opus toolkit: parse, check completeness, measure duration and join clips for the TTS gateway |
| `routing.js` | Routes a TTS use case to an ordered provider chain from configuration (resolveChain) |

## Who reads this (generated)
- `index.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:97:d4fc4e89` · `bot/scripts/quiz/record-one-voice-shared-lines.js:163:84470ea7` (+9)
- `ogg-opus.js` ← imported by `bot/shared/services/tts/index.js:22:109dfb74` · `bot/shared/services/tts/providers/soniox.provider.js:30:7656355b`
- `routing.js` ← imported by `bot/shared/services/tts/index.js:21:eda33c95`

## Never (human)
- Provider choice is config, never code (`bot/shared/services/tts/routing.js:5`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/backfill-bank-quiz-audio.test.js` (index.js)
- `bot/tests/quiz/one-voice-missing-keys.test.js` (index.js)
- `bot/tests/quiz/web-quiz/challenge-clip-warm.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-audio-cap-one.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-bank-voice.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-challenge-listen.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-challenge-story-voice.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-challenge.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-hint.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-one-voice-elevenlabs.test.js` (index.js)
- `bot/tests/quiz/web-quiz/web-quiz-one-voice-long-clips.test.js` (index.js)
- … 9 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/customization.md`?
