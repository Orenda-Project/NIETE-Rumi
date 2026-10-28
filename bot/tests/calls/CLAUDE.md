# calls — Tests for the live WhatsApp voice-call stack (engine, session, prompt, tools)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/calls kg=f722611a5953 gen=b94a1e668efe overflow=22 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `call-engine.test.js` — call lifecycle state machine with fakes
- `call-tools.test.js` — privacy-first tool scoping to the caller
- `call-prompt.test.js` — persona prompt guard-rails
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `call-context-replica.test.js` | Pins that call-context reads of tables the calls stack never writes route to the read replica (bd-vrbk4.2) |
| `call-followups.test.js` | Pins three live-call defects: silent call-permission replies, post-call behaviour and related follow-ups on staging |
| `call-language-follow.test.js` | Pins call language-following: mix only terms inside a sentence, no conflicting 'stay switched' rules (bd-oxu2q) |
| `coaching-voice.test.js` | Pins shared coaching-voice module renders WhatsApp reflective prompt byte-for-byte and feeds call prompt (bd-1hae7.5) |
| `call-gender-neutral.test.js` | Pins that the call prompt never assumes the caller is a woman and bans feminine 2nd-person stems (bd-1hae7.19) |
| `call-prompt.test.js` | Pins the call persona prompt: identity, AI disclosure, reverence and register guard-rails (bd-1hae7.5) |
| `call-voice-telemetry.test.js` | Pins that calls.voice records the voice that actually spoke (Uplift vs OpenAI), not the configured name (bd-oxu2q) |
| … | 22 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Call tools fail closed with no caller id, never query unscoped (tests/calls/call-tools.test.js:6-8, :70)
- CALLS_ENABLED is on only for the literal 'true' (tests/calls/calls-config.test.js:43)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/calls/CLAUDE.index.md`? · `bot/shared/calls/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? (+4)
