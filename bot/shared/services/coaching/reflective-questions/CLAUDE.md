# reflective-questions — Reflective question generation: prompts, language profiles, guardrails, LLM ladder
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/reflective-questions kg=511319822c24 gen=e1243637117b overflow=12 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `question-prompt.js` — per-question prompt for the v12 chain
- `guardrails.js` — pure validation of generated questions
- `language-profiles.js` — add a language here
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `guardrails.js` | Pure language-aware validation of generated reflective questions: timestamps, meta-leaks, romanisation, gender |
| `language-profiles.js` | Per-language data (name, script, register, hints) the reflective-question prompt needs; one entry per language |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `question-prompt.js` | Builds the system prompt for one question of the v12 conversational reflective chain |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `guardrails.js` ← imported by `bot/shared/services/coaching/coaching-card/commitment-card.service.js:27:35714644` · `bot/shared/services/coaching/reflective-conversation.service.js:110:6e560a9c` (+1)
- `language-profiles.js` ← imported by `bot/shared/services/coaching/reflective-conversation.service.js:111:cb1b4a9f` · `bot/shared/services/gpt5-mini.service.js:875:e574b931`
- `corpus-normalise.js` ← imported by `bot/shared/services/gpt5-mini.service.js:888:9b0e7afb`
- `corpus-prompt.js` ← imported by `bot/shared/services/gpt5-mini.service.js:876:86d791bc`
- … 2 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/coaching/reflective-question-english-contract.test.js` (guardrails.js, language-profiles.js, question-prompt.js)
- `tests/coaching/bd-6fdy3-reflection-redesign.test.js` (guardrails.js, language-profiles.js, question-prompt.js)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/tests/calls/CLAUDE.index.md`? · `bot/tests/calls/CLAUDE.md`? (+7)
