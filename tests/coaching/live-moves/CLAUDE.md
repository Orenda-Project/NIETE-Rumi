# live-moves — Tests for live moves: the live list of v10 card moves ticked during a lesson

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching/live-moves kg=1882f3a46e5e gen=0faedc8b2f99 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `switch.test.js` — who gets the live list: app_settings.live_moves, group D teachers in listed schools
- `live-routes.test.js` — the bot's /api/internal/coaching/live/* routes and service behind them
- Run from repo root: `node tests/run.js tests/coaching/live-moves --maxWorkers=2` (tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `detector.test.js` | bd-v0toag.31: detector parses the model reply, dropping unknown, already-ticked and low-confidence moves |
| `live-key.test.js` | bd-v0toag.31: mintLessonKey mints an hour-long single-use Soniox key, or answers cap when 5 streams are held |
| `CLAUDE.md` | (unmapped) |
| `live-record.test.js` | bd-v0toag.31: live_moves record rides the upload, validated and stored in analysis_data; bad record dropped |
| `live-routes.test.js` | bd-v0toag.31: /api/internal/coaching/live/* routes and live-moves.service: secret, eligibility, card availability |
| `card-store.test.js` | bd-v0toag.31: loadCardMoves reads the v10 card JSON beside the card PDF in R2 and flattens moves in order |
| `disagreements.test.js` | bd-v0toag.31: a D teacher's I-did-this tap on a move found not_done gets a short report note; verdicts unchanged |
| `stream-cap.test.js` | bd-v0toag.31: createStreamCap allows five live streams, frees a slot after 180 s idle, same liveId keeps its slot |
| `switch.test.js` | bd-v0toag.31: liveMovesOn reads app_settings.live_moves; on only for group D teachers in listed schools |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY`

## Never (human)
- Live ticks and taps must never change a grading verdict (`disagreements.test.js:4`)
- At most 5 live streams at once; a full cap answers cap without calling Soniox (`stream-cap.test.js`, `live-key.test.js`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/live-moves/CLAUDE.index.md`? · `bot/shared/services/coaching/live-moves/CLAUDE.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/CLAUDE.md`? · `tests/coaching/live-moves/CLAUDE.md`?
