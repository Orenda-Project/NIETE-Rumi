# calls — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/calls -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `assets/` | → (no door; 2 files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `ambience.js` | Loads pre-decoded PCM office/keyboard ambience mixed into live-call audio for a human feel (bd-neeyat) |
| `budget-governor.js` | Enforces live-call caps in code: weekly spend, calls per caller per day, 80% alarm (bd-1hae7.16) |
| `call-context.repo.js` | Thin Supabase queries (user, latest coaching, LP, upcoming visit) feeding the call connect context (bd-1hae7.6) |
| `call-context.service.js` | Assembles the pre-hello connect context with independent soft-failing, time-bounded blocks (bd-1hae7.6) |
| `call-engine.js` | Live-call session registry and lifecycle state machine with injected peers and gates (bd-1hae7.1/.3/.4/.16) |
| `call-forwarder.js` | Bridges Meta call webhooks from the message bot to the separate calls service over private networking (bd-1hae7.2) |
| `call-log.service.js` | Audit trail for live calls: start/end, transcript, context snapshot, tool trace and cost (bd-1hae7.11) |
| `call-memory.service.js` | Folds each finished call's transcript into the caller's rolling call_memory summary via an LLM (bd-neeyat) |
| `call-prompt.service.js` | Builds the live-call assistant persona prompt from coaching voice, reverence rules and context (bd-1hae7.5) |
| `call-session.js` | One live call: wires the WhatsApp RTC peer to the Realtime model with resampling, caps, wrap-up (bd-1hae7.1/.16) |
| `call-tools.repo.js` | Caller-scoped Supabase queries for call tools; throws on an unscoped call (bd-1hae7.9) |
| `call-tools.service.js` | Defines the voice-call tools with output caps and caller-privacy scoping (bd-1hae7.9) |
| `calls-config.js` | Reads the CALLS_ENABLED flag and live-call runtime config at call time, strict === 'true' (bd-1hae7.4) |
| `graph-calls-api.js` | WhatsApp Business Calling API client: pre_accept, accept, reject, terminate (bd-1hae7.1) |
| `pcm.js` | PCM16 helpers for the call audio bridge: linear and streaming resample, downmix, base64 (bd-1hae7.1) |
| `playout-buffer.js` | Chunked jitter buffer for outbound call audio, since Realtime streams faster than real time (bd-1hae7.1) |
| `realtime-client.js` | OpenAI GA Realtime WebSocket client exchanging PCM16 @24k; handles both event-name generations (bd-1hae7.1) |
| `rtc-peer.js` | Sole wrapper of the @roamhq/wrtc native module, exposing answer/audio/state interface for call tests (bd-1hae7.1) |
| `uplift-tts.js` | Streams assistant text sentence-by-sentence to Uplift AI TTS over Socket.IO as the call voice path (bd-oxu2q) |

## Who reads this (all, generated)
- `ambience.js` ← imported by `bot/calls-server.js:33:009fa362` · `bot/shared/calls/rtc-peer.js:28:aed2d4c9`
- `budget-governor.js` ← imported by `bot/calls-server.js:41:b45119b4` · `bot/shared/calls/call-log.service.js:20:1ab2d1b1`
- `call-context.repo.js` ← imported by `bot/calls-server.js:36:00ae89cc` · `bot/scripts/diagnose-calls-context.js:29:2daa9ad5` · `bot/shared/calls/call-tools.repo.js:26:e7896614`
- `call-context.service.js` ← imported by `bot/calls-server.js:35:1116b65e` · `bot/scripts/diagnose-calls-context.js:30:58a8cf4b`
- `call-engine.js` ← imported by `bot/calls-server.js:27:02e5c2e5`
- `call-forwarder.js` ← imported by `bot/whatsapp-bot.js:71:63e86c28` · `bot/calls-server.js:26:d5347e1a`
- `call-log.service.js` ← imported by `bot/calls-server.js:39:0ac0c28b`
- `call-memory.service.js` ← imported by `bot/calls-server.js:40:5685fb45`
- `call-prompt.service.js` ← imported by `bot/calls-server.js:34:cd3a2de7`
- `call-session.js` ← imported by `bot/calls-server.js:28:4568eb42`
- `call-tools.repo.js` ← imported by `bot/calls-server.js:38:984b7014`
- `call-tools.service.js` ← imported by `bot/calls-server.js:37:6b070347`
- `calls-config.js` ← imported by `bot/calls-server.js:25:efdbc8ac`
- `graph-calls-api.js` ← imported by `bot/calls-server.js:32:41154dff`
- `pcm.js` ← imported by `bot/shared/calls/call-session.js:24:622cbac9` · `bot/shared/calls/realtime-client.js:18:91a2cc1d` · `bot/shared/calls/rtc-peer.js:26:91a2cc1d`
- `playout-buffer.js` ← imported by `bot/shared/calls/rtc-peer.js:27:8333c5b4`
- `realtime-client.js` ← imported by `bot/calls-server.js:30:0d55b8e3`
- `rtc-peer.js` ← imported by `bot/calls-server.js:29:e66f9229`
- `uplift-tts.js` ← imported by `bot/calls-server.js:31:1845fa96` · `bot/shared/calls/call-session.js:25:2c9cd465`
- env `CALLS_AMBIENCE_ENABLED` read at `bot/shared/calls/ambience.js:41:1c751ffb`
- env `CALLS_AMBIENCE_KEYBOARD_VOLUME` read at `bot/shared/calls/ambience.js:68:c4bd9175`
- env `CALLS_AMBIENCE_OFFICE_VOLUME` read at `bot/shared/calls/ambience.js:64:40112f01`
- env `CALLS_ENABLED` read at `bot/shared/calls/calls-config.js:96:e4a377ff`
- env `CALLS_FORWARD_SECRET` read at `bot/shared/calls/call-forwarder.js:52:8f2d7725` · `bot/shared/calls/calls-config.js:121:b560f72d`
- env `CALLS_FORWARD_TIMEOUT_MS` read at `bot/shared/calls/call-forwarder.js:21:3ef59fb7`
- env `CALLS_MEMORY_MODEL` read at `bot/shared/calls/call-memory.service.js:19:59fc819d`
- env `CALLS_REASONING_EFFORT` read at `bot/shared/calls/realtime-client.js:187:bbe3c0e9`
- env `CALLS_SERVICE_URL` read at `bot/shared/calls/call-forwarder.js:51:ea15f3ed` · `bot/shared/calls/calls-config.js:122:2f04244d`
- env `CALLS_TRANSCRIBE_MODEL` read at `bot/shared/calls/realtime-client.js:20:098e353d`
- env `CALLS_VAD` read at `bot/shared/calls/calls-config.js:109:1bf60f80`
- env `CALLS_VAD_EAGERNESS` read at `bot/shared/calls/realtime-client.js:148:14b28ac5`
- env `CALLS_VAD_SILENCE_MS` read at `bot/shared/calls/realtime-client.js:142:18c11856`
- env `GRAPH_API_VERSION` read at `bot/shared/calls/graph-calls-api.js:18:af169a62`
- env `OPENAI_API_KEY` read at `bot/shared/calls/calls-config.js:110:b591e19c`
- env `OPENAI_REALTIME_API_KEY` read at `bot/shared/calls/calls-config.js:110:b591e19c`
- env `OPENAI_REALTIME_MODEL` read at `bot/shared/calls/calls-config.js:107:2a635b91`
- env `OPENAI_REALTIME_VOICE` read at `bot/shared/calls/calls-config.js:108:8c432b4e`
- env `TURN_CREDENTIAL` read at `bot/shared/calls/rtc-peer.js:53:5c318ce2`
- env `TURN_FORCE_RELAY` read at `bot/shared/calls/rtc-peer.js:116:b3ca4954`
- env `TURN_URLS` read at `bot/shared/calls/rtc-peer.js:48:213bbd32`
- env `TURN_USERNAME` read at `bot/shared/calls/rtc-peer.js:52:45c66665`
- env `UPLIFT_API_KEY` read at `bot/shared/calls/calls-config.js:129:0c2fdfe9`
- env `UPLIFT_LANGUAGES` read at `bot/shared/calls/calls-config.js:135:c3229da8`
- env `UPLIFT_VOICE_ID` read at `bot/shared/calls/calls-config.js:133:88d8f0ee`
- env `UPLIFT_WS_URL` read at `bot/shared/calls/calls-config.js:134:da182f8a`
- env `VOICE_PROVIDER` read at `bot/shared/calls/calls-config.js:127:fa77d0d7`

## Tests (all, generated)
- `ambience.js` ← `bot/tests/calls/ambience.test.js`?
- `budget-governor.js` ← `bot/tests/calls/budget-governor.test.js`
- `call-context.repo.js` ← `bot/tests/calls/call-context-replica.test.js` · `bot/tests/calls/call-context-user-select.test.js`
- `call-context.service.js` ← `bot/tests/calls/call-answers.test.js` · `bot/tests/calls/call-context.test.js` · `bot/tests/calls/call-followups.test.js`
- `call-engine.js` ← `bot/tests/calls/call-engine.test.js` · `bot/tests/calls/call-voice-telemetry.test.js`
- `call-forwarder.js` ← `bot/tests/calls/call-forwarder.test.js`
- `call-log.service.js` ← `bot/tests/calls/call-context-replica.test.js` · `bot/tests/calls/call-log.test.js` · `bot/tests/calls/call-voice-telemetry.test.js`
- `call-memory.service.js` ← `bot/tests/calls/call-memory.test.js`
- `call-prompt.service.js` ← `bot/tests/calls/call-answers.test.js` · `bot/tests/calls/call-followups.test.js` · `bot/tests/calls/call-gender-neutral.test.js` · `bot/tests/calls/call-greeting-and-sending.test.js` · `bot/tests/calls/call-language-follow.test.js` · `bot/tests/calls/call-opening.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/calls/call-prompt.service.js`)
- `call-session.js` ← `bot/tests/calls/ambience.test.js` · `bot/tests/calls/call-language-follow.test.js` · `bot/tests/calls/call-session.test.js` · `bot/tests/calls/call-voice-telemetry.test.js` · `bot/tests/calls/uplift-voice.test.js`
- `call-tools.repo.js` ← `bot/tests/calls/call-context-replica.test.js`
- `call-tools.service.js` ← `bot/tests/calls/call-tools.test.js`
- `calls-config.js` ← `bot/tests/calls/call-language-follow.test.js` · `bot/tests/calls/calls-config.test.js`
- `graph-calls-api.js` ← `bot/tests/calls/graph-calls-api.test.js`
- `pcm.js` ← `bot/tests/calls/pcm.test.js` · `bot/tests/calls/realtime-client.test.js`
- `playout-buffer.js` ← `bot/tests/calls/playout-buffer.test.js`
- `realtime-client.js` ← `bot/tests/calls/realtime-client.test.js`
- `uplift-tts.js` ← `bot/tests/calls/uplift-voice.test.js`

## Related (all, generated)
- docs: `bot/shared/CLAUDE.md`? · `bot/shared/calls/CLAUDE.index.md`? · `bot/shared/calls/CLAUDE.md`? · `bot/tests/calls/CLAUDE.index.md`? · `bot/tests/calls/CLAUDE.md`?
