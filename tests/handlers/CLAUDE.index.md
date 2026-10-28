# handlers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/handlers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `account-lookup-failure.test.js` | A database outage on user lookup is not "you are not registered"; lookup-failure copy exists in en and ur |
| `audio-service-temp-collision.test.js` | bd-x74wv: AudioService temp files are unique per call, so same-millisecond conversions use their own audio |
| `bd-c5reix-doors-keep-recording.test.js` | bd-c5reix: voice-note and audio-file doors save a classroom recording for the app before sending the app link |
| `bd-s3qsc-language-lookup-uuid.test.js` | bd-s3qsc: getUserLanguage call sites in text-message.handler pass users.id, never the raw phone number |
| `bd-v0toag.56-test-school-recording-analysed.test.js` | bd-v0toag.56: a test-school teacher's recording is always analysed, not swallowed by app_redirect_ai_coaching |
| `child-reply-language-handler.test.js` | Child tutor reply language through the real text handler and openai.service prompt, incl. Roman-Urdu replies |
| `coaching-slash-exit.test.js` | bd-2508: any slash command exits a coaching conversation and runs, instead of being taken as a reflective answer |
| `feature-doors.test.js` | Each live feature (assessment, videos, class manager, attendance) has one callable door outside text-message.handler |
| `menu-list-only.test.js` | bd-2507: /menu sends the interactive list directly, not the approved carousel template first |
| `menu-rows.test.js` | bd-2504: /menu rows from role-features: Training offered to all, Reading Assessment and video generation removed |
| `reply-first-name.test.js` | Text replies hand the model the teacher's first name only, not users.name in full |
| `short-recording-guidance.test.js` | Short-recording guidance reaches the teacher through the real voice handler while the chat answer still goes out |
| `slash-command-similarity.test.js` | A one-word slash command one typo from a single real command (e.g. /assesments) runs that command |
| `text-message-lp-keyword.test.js` | FEAT-059/bd-hvhhu: text handler delegates to the lp-intent matcher and opens the LP menu, gated on PAKISTAN_LP_FLOW_ID |
| `voice-language-floor.test.js` | language-detector blind fallback lands on English, not the registry's first-offered Urdu |
| `voice-note-temp-collision.test.js` | bd-x74wv: two voice notes in the same millisecond are each transcribed and answered from their own audio |
| `voice-reply-language-clamp.test.js` | A voice reply's language is clamped to the offered languages via the shared clamp |
| `voice-reply-tts-gateway.test.js` | Voice replies use the configured TTS gateway; a voice failure falls back to a text answer instead of an error |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/handlers/CLAUDE.index.md`? · `tests/handlers/CLAUDE.md`?
