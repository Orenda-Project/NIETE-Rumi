# live-moves — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/live-moves -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `card-store.js` | Loads the v10 card's moves from the card JSON beside its R2 PDF, 10-minute cache, null on any miss (bd-v0toag.31) |
| `detector-prompt.js` | Prompt and parser asking which unticked lesson-plan moves the latest live transcript shows done (bd-v0toag.31) |
| `detector.js` | Calls the fidelity model for live move ticks with a 20s timeout; never throws, ticks nothing on failure |
| `disagreements.js` | Pure list of moves a teacher tapped "did" that the recording check marked not_done, for a report note only |
| `live-key.js` | Mints one single-use Soniox streaming key per lesson behind the 5-stream cap, never logging the key |
| `live-moves.service.js` | Logic behind the internal /coaching/live/* routes: eligibility, card, key, detect, end; userId from session only |
| `live-record.js` | Validates the live-screen record stored as analysis_data.live_moves; drops malformed records, never refuses upload |
| `stream-cap.js` | In-memory cap of concurrent live streams (5, idle expiry); valid only for the single-replica web service |
| `switch.js` | Fail-closed app_settings.live_moves gate: group D teachers at listed schools while enabled (bd-v0toag.31) |

## Who reads this (all, generated)
- `card-store.js` ← imported by `bot/shared/services/coaching/live-moves/live-moves.service.js:17:ac8199c3`
- `detector-prompt.js` ← imported by `bot/shared/services/coaching/live-moves/detector.js:6:805ddbc5`
- `detector.js` ← imported by `bot/shared/services/coaching/live-moves/live-moves.service.js:19:8d400068`
- `disagreements.js` ← imported by `dashboard/services/coaching-report-view.js:12:d63ab42f`
- `live-key.js` ← imported by `bot/shared/services/coaching/live-moves/live-moves.service.js:18:2319e99b`
- `live-moves.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:2914:dbdf1d67`
- `live-record.js` ← imported by `bot/shared/services/coaching/portal-coaching.service.js:291:2229b7f6` · `bot/shared/services/coaching/live-moves/live-moves.service.js:7:2e8dfb9a`
- `stream-cap.js` ← imported by `bot/shared/services/coaching/live-moves/live-key.js:7:876367f7`
- `switch.js` ← imported by `bot/shared/services/coaching/live-moves/live-moves.service.js:16:47ee8455`
- table `coaching_sessions` (written by `live-moves.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)

## Tests (all, generated)
- `card-store.js` ← `tests/coaching/live-moves/card-store.test.js`
- `detector-prompt.js` ← `tests/coaching/live-moves/detector.test.js`
- `detector.js` ← `tests/coaching/live-moves/detector.test.js`
- `disagreements.js` ← `tests/coaching/live-moves/disagreements.test.js`
- `live-key.js` ← `tests/coaching/live-moves/live-key.test.js`
- `live-record.js` ← `tests/coaching/live-moves/live-record.test.js`?
- `stream-cap.js` ← `tests/coaching/live-moves/live-key.test.js` · `tests/coaching/live-moves/live-routes.test.js` · `tests/coaching/live-moves/stream-cap.test.js`
- `switch.js` ← `tests/coaching/live-moves/switch.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/live-moves/CLAUDE.index.md`? · `bot/shared/services/coaching/live-moves/CLAUDE.md`?
