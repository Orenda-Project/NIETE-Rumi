# reflective-questions — Reflective question generation: prompts, language profiles, guardrails, LLM ladder
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/reflective-questions kg=51da8c9200cc gen=f9973bf7a69a overflow=10 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `question-prompt.js` | Builds the system prompt for one question of the v12 conversational reflective chain |
| `corpus-prompt.js` | Builds the system prompt extracting the lesson corpus (moments, through-line) that reflective questions draw on |
| `corpus-normalise.js` | Fixes a known Urdu anchor misspelling in the corpus time phrases before they reach a question (bd-gr4fy.5.13) |
| … | 1 more → `CLAUDE.index.md` |

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
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
