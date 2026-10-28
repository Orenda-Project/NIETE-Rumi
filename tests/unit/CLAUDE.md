# unit — Misc unit tests: llm-client, WhatsApp senders, plus sprint-N OSS-prep checks

<!-- kg:meta repo=NIETE-Rumi dir=tests/unit kg=02e02e52c495 gen=2038e02f485e overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `llm-client-timeout-wiring.test.js` — timeout and maxRetries on all three OpenAI clients (bd-v60qf)
- `whatsapp-interactive-on-error.test.js` — refused sends hand their error to onError
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/unit --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sprint-0/` | → (no door; 1 test files) |
| `sprint-1/` | Early open-source prep tests: branding, CLI simulator, LLM factory, feature gating → `sprint-1/CLAUDE.md` |
| `sprint-2/` | → (no door; 1 test files) |
| `sprint-3/` | → (no door; 1 test files) |
| `sprint-4/` | → (no door; 1 test files) |
| `whatsapp-interactive-on-error.test.js` | Pins that refused interactive sends hand the Graph error to onError and log at error, still answering false |
| `CLAUDE.md` | (unmapped) |
| `llm-cost-queryable.test.js` | bd-9b58p: model spend fields are promoted to numeric Axiom columns so sum() works; unpriced stays null |
| `whatsapp-interactive-message-id.test.js` | Pins that WhatsApp interactive senders report Meta's message id to onMessageId while still answering a boolean |
| `llm-client-anthropic-direct.test.js` | bd-yoc6i: llm-client routes anthropic-direct/ models to Anthropic on the grant key, default disabled, OpenRouter default |
| `llm-client-timeout-behavior.test.js` | bd-v60qf: behavioural half: real SDK with mocked fetch, a hung LLM call times out on both OpenRouter and Anthropic lanes |
| `llm-client-timeout-wiring.test.js` | bd-v60qf: wiring half: llm-client hands timeout 180000 and maxRetries to each of its three OpenAI clients |
| `webhook-inbound-log-voice-note.test.js` | Pins that the webhook inbound log detects a voice note from audio.voice, not the nonexistent message.voice |

## Who reads this (generated)
- (none)

## Never (human)
- llm-client calls keep per-call timeout and maxRetries (llm-client-timeout-wiring.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/unit/CLAUDE.md`? · `tests/unit/sprint-1/CLAUDE.md`?
