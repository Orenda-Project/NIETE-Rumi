# handlers — Text, voice and menu handler behaviour of the bot through real handlers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/handlers kg=8144a1785c58 gen=26e5952ba5a5 overflow=6 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `feature-doors.test.js` — each feature has one callable door outside text-message.handler
- `voice-note-temp-collision.test.js` — per-call temp files for voice notes (bd-x74wv)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/handlers --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `feature-doors.test.js` | Each live feature (assessment, videos, class manager, attendance) has one callable door outside text-message.handler |
| `CLAUDE.index.md` | (unmapped) |
| `short-recording-guidance.test.js` | Short-recording guidance reaches the teacher through the real voice handler while the chat answer still goes out |
| `CLAUDE.md` | (unmapped) |
| `voice*` | 4 files; most used `voice-note-temp-collision.test.js`: bd-x74wv: two voice notes in the same millisecond are each transcribed and answered from their own audio |
| `bd*` | 3 files; most used `bd-v0toag.56-test-school-recording-analysed.test.js`: bd-v0toag.56: a test-school teacher's recording is always analysed, not swallowed by app_redirect_ai_coaching |
| `audio-service-temp-collision.test.js` | bd-x74wv: AudioService temp files are unique per call, so same-millisecond conversions use their own audio |
| `account-lookup-failure.test.js` | A database outage on user lookup is not "you are not registered"; lookup-failure copy exists in en and ur |
| `child-reply-language-handler.test.js` | Child tutor reply language through the real text handler and openai.service prompt, incl. Roman-Urdu replies |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- getUserLanguage takes users.id, never a phone (bd-s3qsc, tests/handlers/bd-s3qsc-language-lookup-uuid.test.js:25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? (+5)
