# coaching-card — Commitment card: content, HTML template and PNG render, button replies
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/coaching-card kg=6519f2a3fe48 gen=827e33172de7 overflow=26 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- table `coaching_sessions` (written by `card-response.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+87)
- table `coaching_sessions` whole row (`*`) (written by `card-response.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? (+10)
- … 5 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/coaching-card.test.js` (card-image.service.js, card-response.service.js, prioritized-action.service.js)
- `tests/coaching/coaching-flow-integration.test.js` (card-image.service.js, card-response.service.js, prioritized-action.service.js)
- … 21 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.index.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.md`? · `bot/tests/coaching/CLAUDE.index.md`? · `bot/tests/coaching/CLAUDE.md`? (+4)
