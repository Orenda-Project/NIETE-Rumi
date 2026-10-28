# sa-game — Jest tests for the SA game switch, door, page route and run sink

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/sa-game kg=849ca14cf810 gen=098c58255575 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `sa-game-sink.test.js` — end-to-end sink over a real http server
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sa-game-sink.test.js` | Pins the game sink end to end over HTTP: session, batch, caps, presign, register, status, store path choice |
| `CLAUDE.md` | (unmapped) |
| `sa-game-page.test.js` | Pins /api/internal/sagame/page/:token: off 404, no child 401, child gets language and game form |
| `sa-game-audio-purge.test.js` | Pins purge-sa-game-audio: game recordings older than 24h leave R2, dry run default, own-prefix only |
| `sa-game-door.test.js` | Pins the SA game row in the games door via the hub switch cache: off untouched, on adds a bigtest row |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/child-test/CLAUDE.md`? · `bot/shared/services/child-test/draw/CLAUDE.index.md`? · `bot/shared/services/child-test/draw/CLAUDE.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/sa-game/CLAUDE.index.md`? · `bot/shared/services/sa-game/CLAUDE.md`? (+3)
