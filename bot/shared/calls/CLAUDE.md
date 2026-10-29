# calls — Live voice-call stack: WhatsApp calling, WebRTC, Realtime model, call tools
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/calls kg=f407a013e0ac gen=6c066a926772 overflow=47 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `call-engine.js` — session registry and lifecycle
- `call-session.js` — one call's audio and model wiring
- `calls-config.js` — CALLS_ENABLED and limits
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assets/` | → (no door; 2 files) |
| `call*` | 10 files; most used `call-prompt.service.js`: Builds the live-call assistant persona prompt from coaching voice, reverence rules and context (bd-1hae7.5) |
| `pcm.js` | PCM16 helpers for the call audio bridge: linear and streaming resample, downmix, base64 (bd-1hae7.1) |
| `budget-governor.js` | Enforces live-call caps in code: weekly spend, calls per caller per day, 80% alarm (bd-1hae7.16) |
| `calls-config.js` | Reads the CALLS_ENABLED flag and live-call runtime config at call time, strict === 'true' (bd-1hae7.4) |
| `ambience.js` | Loads pre-decoded PCM office/keyboard ambience mixed into live-call audio for a human feel (bd-neeyat) |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `call-context.repo.js` ← imported by `bot/calls-server.js:36:00ae89cc` · `bot/scripts/diagnose-calls-context.js:29:2daa9ad5` (+1)
- `pcm.js` ← imported by `bot/shared/calls/call-session.js:24:622cbac9` · `bot/shared/calls/realtime-client.js:18:91a2cc1d` (+1)
- `ambience.js` ← imported by `bot/calls-server.js:33:009fa362` · `bot/shared/calls/rtc-peer.js:28:aed2d4c9`
- `budget-governor.js` ← imported by `bot/calls-server.js:41:b45119b4` · `bot/shared/calls/call-log.service.js:20:1ab2d1b1`
- … 42 more → `CLAUDE.index.md`

## Never (human)
- The five call-tool finders call requireCaller, which throws on a missing caller id (call-tools.repo.js:36)
- Only rtc-peer.js touches the wrtc native module (rtc-peer.js:3)
- Calls flag is strict === 'true', not presence (calls-config.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/calls/call-context-replica.test.js` (call-context.repo.js, call-log.service.js, call-tools.repo.js)
- `bot/tests/calls/call-language-follow.test.js` (call-prompt.service.js, call-session.js, calls-config.js)
- … 26 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/CLAUDE.md`?
