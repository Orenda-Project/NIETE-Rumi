# reflective-questions — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/reflective-questions -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `corpus-normalise.js` | Fixes a known Urdu anchor misspelling in the corpus time phrases before they reach a question (bd-gr4fy.5.13) |
| `corpus-prompt.js` | Builds the system prompt extracting the lesson corpus (moments, through-line) that reflective questions draw on |
| `guardrails.js` | Pure language-aware validation of generated reflective questions: timestamps, meta-leaks, romanisation, gender |
| `language-profiles.js` | Per-language data (name, script, register, hints) the reflective-question prompt needs; one entry per language |
| `llm-router.service.js` | Reflective-question LLM failover ladder via OpenRouter: primary, one retry, then a different vendor |
| `question-prompt.js` | Builds the system prompt for one question of the v12 conversational reflective chain |

## Who reads this (all, generated)
- `corpus-normalise.js` ← imported by `bot/shared/services/gpt5-mini.service.js:888:9b0e7afb`
- `corpus-prompt.js` ← imported by `bot/shared/services/gpt5-mini.service.js:876:86d791bc`
- `guardrails.js` ← imported by `bot/shared/services/coaching/coaching-card/commitment-card.service.js:27:35714644` · `bot/shared/services/coaching/reflective-conversation.service.js:110:6e560a9c` · `bot/shared/services/gpt5-mini.service.js:918:d5aeeb7e`
- `language-profiles.js` ← imported by `bot/shared/services/coaching/reflective-conversation.service.js:111:cb1b4a9f` · `bot/shared/services/gpt5-mini.service.js:875:e574b931`
- `llm-router.service.js` ← imported by `bot/shared/services/gpt5-mini.service.js:877:7c9a8fe1`
- `question-prompt.js` ← imported by `bot/shared/services/gpt5-mini.service.js:916:ef82afe5`

## Tests (all, generated)
- `corpus-prompt.js` ← `tests/coaching/corpus-time-anchor.test.js`
- `guardrails.js` ← `bot/tests/coaching/reflective-question-english-contract.test.js` · `bot/tests/whatsapp/send-audio-absent-temp-dir.test.js` · `tests/coaching/bd-6fdy3-reflection-redesign.test.js` · `tests/coaching/gender-neutral-urdu-address.test.js` · `tests/coaching/reflective-v12-question-chain.test.js`
- `language-profiles.js` ← `bot/tests/coaching/reflective-question-english-contract.test.js` · `bot/tests/whatsapp/send-audio-absent-temp-dir.test.js` · `tests/coaching/bd-6fdy3-reflection-redesign.test.js` · `tests/coaching/bd2651-voice-language-rules.test.js` · `tests/coaching/corpus-time-anchor.test.js` · `tests/coaching/reflective-v12-question-chain.test.js`
- `llm-router.service.js` ← `tests/e2e-mock/reflective-router-cassette.test.js`
- `question-prompt.js` ← `bot/tests/calls/coaching-voice.test.js` · `bot/tests/coaching/reflective-question-english-contract.test.js` · `tests/coaching/bd-6fdy3-reflection-redesign.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
