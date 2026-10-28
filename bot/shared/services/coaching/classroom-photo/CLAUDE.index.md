# classroom-photo — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/classroom-photo -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `add-another.service.js` | Handles the photo_more_ "Add another" tap, reopening the photo step only when the session status allows (bd-pzs9a) |
| `capture.service.js` | Captures classroom photos sent as documents or racing analysis; debounces one receipt prompt per photo burst (bd-3ipd2) |
| `photo-analysis.service.js` | Vision-model reading of a classroom photo with framework prompts, plus the v2 fidelity-evidence reader |
| `photo-evidence-schema.js` | Cleans and scrubs vision readings (kinds, caps, digit runs, injection text) before the fidelity grader sees them |
| `photo-prompt.service.js` | Builds the interactive Yes/No buttons asking a teacher whether to share a classroom photo |
| `photo-yes.service.js` | Guarded handler for the photo gate's photo_yes_ tap; refuses stale taps on cancelled sessions (bd-n9832) |
| `scorer-image.js` | Downscales a classroom photo to 768px JPEG for the scoring call using lazily loaded sharp (bd-8s2xb) |

## Who reads this (all, generated)
- `add-another.service.js` ← imported by `bot/whatsapp-bot.js:1102:1947474a`
- `capture.service.js` ← imported by `bot/shared/services/coaching/media-attach.service.js:73:8e57f19e`
- `photo-analysis.service.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:308:bfa6cd9c` · `bot/shared/services/observe/observe2/moments.js:274:c9288d8e`
- `photo-evidence-schema.js` ← imported by `bot/shared/services/coaching/fidelity/grader-photo-evidence.js:17:dfea415f` · `bot/shared/services/coaching/classroom-photo/photo-analysis.service.js:194:d6cdefeb`
- `photo-prompt.service.js` ← imported by `bot/shared/services/coaching/transcription-processor.service.js:582:2c6b1ca2` · `bot/shared/services/observe/observe-resume.service.js:77:3496e62f`
- `photo-yes.service.js` ← imported by `bot/whatsapp-bot.js:1079:8a561c11`
- `scorer-image.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:369:f3e5b32c` · `bot/shared/services/coaching/classroom-photo/photo-analysis.service.js:157:1601e837`
- column `coaching_sessions.conversation_state` (written by `add-another.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/shared/services/coaching/coaching-session.service.js:315:e9871896` · `bot/shared/services/coaching/continue-coaching.service.js:48:65f3f9dd` · `bot/shared/services/coaching/finish-early.service.js:41:e9871896` (+8: `python3 kg/kg.py who-reads coaching_sessions.conversation_state`)
- column `coaching_sessions.status` (written by `add-another.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1923:21a55915` · `bot/shared/handlers/voice-message.handler.js:744:21a55915` (+39: `python3 kg/kg.py who-reads coaching_sessions.status`)
- table `coaching_sessions` whole row (`*`) (written by `add-another.service.js`, `capture.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? · `bot/shared/services/coaching/analysis-processor.service.js:124:a23aff58`? (+9: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `add-another.service.js`, `capture.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- env `COACHING_PHOTO_BURST_EARLY_CHECK_MS` read at `bot/shared/services/coaching/classroom-photo/capture.service.js:37:8b89e11a`
- env `COACHING_PHOTO_LOCK_WAIT_MS` read at `bot/shared/services/coaching/classroom-photo/capture.service.js:101:ef876897`
- env `COACHING_PHOTO_PROMPT_DEBOUNCE_MS` read at `bot/shared/services/coaching/classroom-photo/capture.service.js:27:5e855f52`

## Tests (all, generated)
- `add-another.service.js` ← `tests/coaching/bd-pzs9a-photo-add-another.test.js` · `tests/coaching/meta-bill-nc4-photo-step.test.js`
- `capture.service.js` ← `tests/coaching/meta-bill-nc4-photo-step.test.js` · `tests/meta-bill-cut/fx3-silent-turn-typing.test.js`
- `photo-analysis.service.js` ← `tests/coaching/bd-b3pop-photo-vision-v2.test.js` · `tests/coaching/bd-b3pop-processor-photo-evidence.test.js` · `tests/coaching/coaching-flow-integration.test.js` · `tests/llm/vision-caller-repairs.test.js` · `tests/observe2/added-plan-defaults.test.js`
- `photo-prompt.service.js` ← `tests/coaching/bd-8s2xb-photo-surfaces.test.js` · `tests/coaching/coaching-flow-integration.test.js` · `tests/coaching/meta-bill-nc4-photo-step.test.js`
- `photo-yes.service.js` ← `tests/coaching/meta-bill-nc4-photo-step.test.js`
- `scorer-image.js` ← `tests/coaching/bd-8s2xb-scorer-image-encode.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`?
