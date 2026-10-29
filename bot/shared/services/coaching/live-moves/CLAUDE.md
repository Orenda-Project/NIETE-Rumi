# live-moves — Live move ticking while a teacher records in the app (group D only)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/live-moves kg=84a9647bc51e gen=0914e78bd17e overflow=14 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `live-moves.service.js` — logic behind /api/internal/coaching/live/*
- `switch.js` — who sees the live list
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `stream-cap.js` | In-memory cap of concurrent live streams (5, idle expiry); valid only for the single-replica web service |
| `card-store.js` | Loads the v10 card's moves from the card JSON beside its R2 PDF, 10-minute cache, null on any miss (bd-v0toag.31) |
| `detector-prompt.js` | Prompt and parser asking which unticked lesson-plan moves the latest live transcript shows done (bd-v0toag.31) |
| `detector.js` | Calls the fidelity model for live move ticks with a 20s timeout; never throws, ticks nothing on failure |
| `live*` | 3 files; most used `live-record.js`: Validates the live-screen record stored as analysis_data.live_moves; drops malformed records, never refuses upload |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `live-moves.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+87)
- `live-record.js` ← imported by `bot/shared/services/coaching/portal-coaching.service.js:291:2229b7f6` · `bot/shared/services/coaching/live-moves/live-moves.service.js:7:2e8dfb9a`
- `card-store.js` ← imported by `bot/shared/services/coaching/live-moves/live-moves.service.js:17:ac8199c3`
- `detector-prompt.js` ← imported by `bot/shared/services/coaching/live-moves/detector.js:6:805ddbc5`
- … 6 more → `CLAUDE.index.md`

## Never (human)
- stream-cap.js is process memory; never use it from the SQS workers (stream-cap.js:5)
- Detector never throws; failure ticks nothing (detector.js:12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/live-moves/detector.test.js` (detector-prompt.js, detector.js)
- `tests/coaching/live-moves/live-key.test.js` (live-key.js, stream-cap.js)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
