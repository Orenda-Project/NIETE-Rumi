# calls — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/calls -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `ambience.test.js` | Pins the call audio mixer: continuous office chatter, typing only during lookups, no clipping (bd-1hae7.18) |
| `budget-governor.test.js` | Pins the call budget governor: weekly cap, per-caller daily cap and 80% alarm enforced in code (bd-1hae7.16) |
| `call-answers.test.js` | Pins that the call prompt makes the assistant answer direct score questions from the coaching record it holds |
| `call-context-replica.test.js` | Pins that call-context reads of tables the calls stack never writes route to the read replica (bd-vrbk4.2) |
| `call-context-user-select.test.js` | Pins that the call caller lookup selects only columns that exist on users, with no glued names (bd-1hae7.20) |
| `call-context.test.js` | Pins call connect-time context: caller name, school, subjects, language; fail-open for unknown callers (bd-1hae7.6) |
| `call-engine.test.js` | Pins the CallEngine state machine with fakes: connect, pre_accept, accept, terminate, admission gate, SIGTERM drain |
| `call-followups.test.js` | Pins three live-call defects: silent call-permission replies, post-call behaviour and related follow-ups on staging |
| `call-forwarder.test.js` | Pins call-forwarder: value.calls payloads forwarded to the calls service, never handled as messages (bd-1hae7.2) |
| `call-gender-neutral.test.js` | Pins that the call prompt never assumes the caller is a woman and bans feminine 2nd-person stems (bd-1hae7.19) |
| `call-greeting-and-sending.test.js` | Pins that the call assistant introduces herself once and keeps pronunciation guidance after trimming (bd-1hae7.19) |
| `call-language-follow.test.js` | Pins call language-following: mix only terms inside a sentence, no conflicting 'stay switched' rules (bd-oxu2q) |
| `call-log.test.js` | Pins call audit spine: row, transcript, exact instructions, per-tool trace rows and cost via call-log (bd-1hae7.11) |
| `call-memory.test.js` | Pins the post-call memory writer: LLM merge into call_memory, call_count increment, summary hard cap (bd-neeyat) |
| `call-opening.test.js` | Pins that the call opening says the assistant's name in Urdu script and never the Latin spelling (bd-1hae7.19) |
| `call-overflow-strings.test.js` | Pins the strings a declined (over-capacity) caller receives: catalog coverage, Urdu register, brevity (bd-1hae7.3) |
| `call-prompt.test.js` | Pins the call persona prompt: identity, AI disclosure, reverence and register guard-rails (bd-1hae7.5) |
| `call-register-role.test.js` | Pins both Urdu and English register blocks ship in the call prompt whatever the stored language, feminine self-reference |
| `call-session.test.js` | Pins CallSession with injected peer and Realtime client: audio, barge-in, watchdog, 5-minute cap (bd-1hae7.1/.16) |
| `call-tools.test.js` | Pins call tools privacy first: every tool is scoped to the caller and fails closed with no caller id (bd-1hae7.9) |
| `call-voice-telemetry.test.js` | Pins that calls.voice records the voice that actually spoke (Uplift vs OpenAI), not the configured name (bd-oxu2q) |
| `calls-config.test.js` | Pins calls-config: CALLS_ENABLED is on only for the literal string 'true', shipping dark by default (bd-1hae7.4) |
| `calls-server-no-hardcoded-number.test.js` | Pins calls-server.js carries no hardcoded phone number; the alarm recipient comes from OPERATOR_WHATSAPP (bd-1hae7.20) |
| `coaching-voice.test.js` | Pins shared coaching-voice module renders WhatsApp reflective prompt byte-for-byte and feeds call prompt (bd-1hae7.5) |
| `graph-calls-api.test.js` | Pins WhatsApp Calling Graph client: SDP sent as ANSWER for pre_accept/accept, none on reject (bd-1hae7.1) |
| `pcm.test.js` | Pins PCM helpers for the call audio bridge: linear resampling, empty input, 16 kHz to 24 kHz (bd-1hae7.1) |
| `playout-buffer.test.js` | Pins PlayoutBuffer jitter behaviour: silence until prebuffer, playout, re-arm after underrun, no mid-response drops |
| `realtime-client.test.js` | Pins the OpenAI GA Realtime client: GA endpoint, no OpenAI-Beta header, both event-name generations, session config |
| `uplift-voice.test.js` | Pins Uplift as second voice engine: text-mode model on Urdu calls, tools unchanged, per-call fallback (bd-oxu2q) |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/calls/CLAUDE.index.md`? · `bot/shared/calls/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/calls/CLAUDE.index.md`? · `bot/tests/calls/CLAUDE.md`?
