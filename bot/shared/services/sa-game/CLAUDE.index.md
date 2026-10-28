# sa-game — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/sa-game -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `flag.js` | Switches for the SA game (app_settings sa_game, sa_game_tower_cycle) with 30s cache, fail closed; also hub warm cache |
| `page.js` | Decides who the game page is for from hub token and chip, returning grade and form (game.G1/G23/G45) or an error status |
| `routes.js` | Internal /api/internal/sagame router the portal edge calls with x-api-key: page facts plus the sink |
| `sink.js` | Game run sink: session per child/part/form/day, batches of events and results, audio presign and register |
| `sink.routes.js` | Express routes for the game sink (session, batch, audio presign/register, status) mounted behind the internal key |
| `store-adapter.js` | Stores game runs either as child_test self_run sessions or web_quiz_challenge_runs, chosen by a schema probe |

## Who reads this (all, generated)
- `flag.js` ← imported by `bot/shared/services/quiz/sa-game-door.js:13:6746c529` · `bot/shared/services/sa-game/page.js:14:737dcd8b` · `bot/shared/services/sa-game/sink.js:90:86e9350c` · `bot/shared/services/sa-game/sink.routes.js:20:add410fe`
- `page.js` ← imported by `bot/shared/services/sa-game/routes.js:17:6edde2c1`
- `routes.js` ← imported by `bot/shared/services/first-touch/sa-game.mount.js:9:ba848346`
- `sink.js` ← imported by `bot/shared/services/sa-game/sink.routes.js:20:add410fe`
- `sink.routes.js` ← imported by `bot/shared/services/sa-game/routes.js:23:e3c64587`
- `store-adapter.js` ← imported by `bot/scripts/child-test/purge-sa-game-audio.js:71:cb8701d4` · `bot/shared/services/sa-game/sink.js:105:cca0f140`
- env `CHILD_TEST_R2_ENV` read at `bot/shared/services/sa-game/sink.js:53:882dfd55`
- env `RAILWAY_ENVIRONMENT` read at `bot/shared/services/sa-game/sink.js:53:882dfd55`

## Tests (all, generated)
- `page.js` ← `bot/tests/sa-game/sa-game-page.test.js`
- `routes.js` ← `bot/tests/sa-game/sa-game-page.test.js` · `bot/tests/sa-game/sa-game-sink.test.js`
- `store-adapter.js` ← `bot/tests/sa-game/sa-game-sink.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/sa-game/CLAUDE.index.md`? · `bot/shared/services/sa-game/CLAUDE.md`? · `bot/tests/sa-game/CLAUDE.md`?
