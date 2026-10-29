# sa-game — The SA battery as a home game: switch, page facts, run sink behind the portal edge

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/sa-game kg=a754b58b0cf1 gen=b338267ef7a8 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `routes.js` — internal router the portal calls with x-api-key
- `sink.js` — session, batch, audio presign and register for a run
- `flag.js` — sa_game switches
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `flag.js` | Switches for the SA game (app_settings sa_game, sa_game_tower_cycle) with 30s cache, fail closed; also hub warm cache |
| `routes.js` | Internal /api/internal/sagame router the portal edge calls with x-api-key: page facts plus the sink |
| `store-adapter.js` | Stores game runs either as child_test self_run sessions or web_quiz_challenge_runs, chosen by a schema probe |
| `page.js` | Decides who the game page is for from hub token and chip, returning grade and form (game.G1/G23/G45) or an error status |
| `sink.js` | Game run sink: session per child/part/form/day, batches of events and results, audio presign and register |
| `sink.routes.js` | Express routes for the game sink (session, batch, audio presign/register, status) mounted behind the internal key |

## Who reads this (generated)
- `flag.js` ← imported by `bot/shared/services/quiz/sa-game-door.js:13:6746c529` · `bot/shared/services/sa-game/page.js:14:737dcd8b` (+2)
- `store-adapter.js` ← imported by `bot/scripts/child-test/purge-sa-game-audio.js:71:cb8701d4` · `bot/shared/services/sa-game/sink.js:105:cca0f140`
- `page.js` ← imported by `bot/shared/services/sa-game/routes.js:17:6edde2c1`
- `routes.js` ← imported by `bot/shared/services/first-touch/sa-game.mount.js:9:ba848346`
- `sink.js` ← imported by `bot/shared/services/sa-game/sink.routes.js:20:add410fe`
- `sink.routes.js` ← imported by `bot/shared/services/sa-game/routes.js:23:e3c64587`
- env read here: `CHILD_TEST_R2_ENV` · `RAILWAY_ENVIRONMENT`

## Never (human)
- Switches fail closed: only JSON true is on (flag.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/sa-game/sa-game-page.test.js` (page.js, routes.js)
- `bot/tests/sa-game/sa-game-sink.test.js` (routes.js, store-adapter.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
