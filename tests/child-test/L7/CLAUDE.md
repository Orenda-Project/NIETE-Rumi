# L7 — Coach-app child-test API on the bot, plus the self-administered assessment
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L7 kg=e0e518e8afec gen=31139cea8f86 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `app-api.service.test.js` — the portal relays every call here
- `sa-sync.service.test.js` — phone batches and recordings
- Run from repo root: `node tests/run.js tests/child-test/L7 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `app*` | 3 files; most used `app-integration.test.js`: Coach-app path over the real store, item bank and gate with only network faked: one child start to finish (bd-s1oo0.7) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `sa*` | 6 files; most used `sa-store.test.js`: Tests sa-store: one blocks row per subtask with phone evidence and marks, written once; unscored recordings parked |

## Who reads this (generated)
- table `child_test_draws` (written by `app-integration.test.js`) ← read by `bot/shared/services/child-test/check-flow/check-store.js:145:5bbb6be1`? · `bot/shared/services/child-test/store.js:417:c5aa16bb`? (+1)
- env read here: `CHILD_TEST_ENABLED` · `CHILD_TEST_R2_ENV` · `INTERNAL_API_KEY` · `RAILWAY_ENVIRONMENT` · `WEB_QUIZ_TOKEN_SECRET`

## Never (human)
- Stop and language events live on child_test_sessions.device.events, no new table (tests/child-test/L7/sa-r7b-stop-events.service.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/app/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L7/CLAUDE.index.md`? (+1)
