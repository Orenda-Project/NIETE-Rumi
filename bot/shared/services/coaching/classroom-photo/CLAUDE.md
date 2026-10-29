# classroom-photo — Classroom photo step: capture, taps, vision reading, evidence cleaning
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/classroom-photo kg=d3280c693b54 gen=b28a2581c3e0 overflow=17 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `capture.service.js` — photos sent as documents or racing analysis, one prompt per burst
- `photo-yes.service.js` — guarded photo_yes_ tap handler
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `photo*` | 4 files; most used `photo-analysis.service.js`: Vision-model reading of a classroom photo with framework prompts, plus the v2 fidelity-evidence reader |
| `add-another.service.js` | Handles the photo_more_ "Add another" tap, reopening the photo step only when the session status allows (bd-pzs9a) |
| `capture.service.js` | Captures classroom photos sent as documents or racing analysis; debounces one receipt prompt per photo burst (bd-3ipd2) |
| `scorer-image.js` | Downscales a classroom photo to 768px JPEG for the scoring call using lazily loaded sharp (bd-8s2xb) |

## Who reads this (generated)
- table `coaching_sessions` (written by `add-another.service.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- column `coaching_sessions.status` (written by `add-another.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` (+41)
- table `coaching_sessions` whole row (`*`) (written by `add-another.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? (+11)
- … 11 more → `CLAUDE.index.md`

## Never (human)
- Photo reading fields are untrusted; clean them in photo-evidence-schema.js before any grader sees them (bd-b3pop.15)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/meta-bill-nc4-photo-step.test.js` (add-another.service.js, capture.service.js, photo-prompt.service.js, photo-yes.service.js)
- `tests/coaching/coaching-flow-integration.test.js` (photo-analysis.service.js, photo-prompt.service.js)
- … 8 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
