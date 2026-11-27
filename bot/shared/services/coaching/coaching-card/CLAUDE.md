# coaching-card — Commitment card: content, HTML template and PNG render, button replies
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/coaching-card kg=8f274c103641 gen=ba0e01048a50 overflow=27 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `commitment-card.service.js` — builds the card content from the reflective answer
- `card-response.service.js` — handles the teacher's card button taps
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `commitment-card.service.js` | Uses an LLM to fuse the teacher's reflective commitment with one lesson-rooted action for the commitment card |
| `card*` | 3 files; most used `card-response.service.js`: Handles teacher button replies to the coaching card and stores them in coaching_sessions.prioritized_action |
| `prioritized-action.service.js` | Extracts indicators from an analysis and picks one focus tip, the weakest askable indicator, for the coaching card |

## Who reads this (generated)
- table `coaching_sessions` (written by `card-response.service.js`) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/scripts/quiz/backfill-quiz-lesson-links.js:76:0b673d4d`? (+103)
- table `coaching_sessions` whole row (`*`) (written by `card-response.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1983:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:770:d2b02c3e`? (+10)
- column `coaching_sessions.prioritized_action` (written by `card-response.service.js`) ← read by `bot/shared/services/coaching/coaching-trend.service.js:140:1f9a2623` · `bot/shared/services/coaching/report-generator.service.js:420:cfc5016d` (+6)
- … 4 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/coaching-card.test.js` (card-image.service.js, card-response.service.js, prioritized-action.service.js)
- `tests/coaching/coaching-flow-integration.test.js` (card-image.service.js, card-response.service.js, prioritized-action.service.js)
- … 23 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
